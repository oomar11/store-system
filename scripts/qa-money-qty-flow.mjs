import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

function loadEnv(path) {
  const raw = readFileSync(path, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    let v = line.slice(i + 1);
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i)] = v;
  }
  return env;
}

const env = loadEnv(".env.local");
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const QA_EMAIL = "qa-test-agent@store.local";
const QA_PASS = "QaTest!Agent-2026";

async function ensureQaUser() {
  const { data: listed } = await admin.auth.admin.listUsers({ perPage: 200 });
  let user = listed?.users?.find((u) => u.email === QA_EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: QA_EMAIL,
      password: QA_PASS,
      email_confirm: true,
      user_metadata: { full_name: "QA TEST AGENT" },
    });
    if (error) throw error;
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, {
      password: QA_PASS,
      email_confirm: true,
    });
  }

  // Ensure active profile with owner/manager perms
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    await admin.from("profiles").insert({
      id: user.id,
      full_name: "QA TEST AGENT",
      role: "owner",
      is_active: true,
    });
  } else {
    await admin
      .from("profiles")
      .update({ role: "owner", is_active: true, full_name: "QA TEST AGENT" })
      .eq("id", user.id);
  }

  return user;
}

function clientAsUser(accessToken) {
  return createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function snapshot(sb, productId, customerId, supplierId, safeId) {
  const [{ data: p }, { data: c }, { data: s }, { data: safe }] =
    await Promise.all([
      admin.from("products").select("quantity").eq("id", productId).single(),
      admin.from("customers").select("balance").eq("id", customerId).single(),
      admin.from("suppliers").select("balance").eq("id", supplierId).single(),
      admin.from("safes").select("balance").eq("id", safeId).single(),
    ]);
  return {
    qty: Number(p.quantity),
    custBal: Number(c.balance),
    supBal: Number(s.balance),
    safeBal: Number(safe.balance),
  };
}

async function main() {
  const user = await ensureQaUser();
  const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
    email: QA_EMAIL,
    password: QA_PASS,
  });
  if (authErr || !auth.session) throw authErr || new Error("no session");
  const sb = clientAsUser(auth.session.access_token);

  // Ensure QA fixtures
  let { data: product } = await admin
    .from("products")
    .select("*")
    .eq("sku", "QA-TEST-SKU")
    .maybeSingle();
  if (!product) {
    const { data, error } = await admin
      .from("products")
      .insert({
        name: "QA-TEST Product",
        sku: "QA-TEST-SKU",
        buy_price: 10,
        sell_price: 20,
        quantity: 1000,
        opening_quantity: 1000,
        is_active: true,
      })
      .select("*")
      .single();
    if (error) throw error;
    product = data;
  } else {
    await admin
      .from("products")
      .update({ quantity: 1000, is_active: true })
      .eq("id", product.id);
    product.quantity = 1000;
  }

  let { data: customer } = await admin
    .from("customers")
    .select("*")
    .eq("name", "QA-TEST Customer")
    .maybeSingle();
  if (!customer) {
    const { data, error } = await admin
      .from("customers")
      .insert({
        name: "QA-TEST Customer",
        balance: 0,
        opening_balance: 0,
      })
      .select("*")
      .single();
    if (error) throw error;
    customer = data;
  } else {
    await admin
      .from("customers")
      .update({ balance: 0 })
      .eq("id", customer.id);
    customer.balance = 0;
  }

  let { data: supplier } = await admin
    .from("suppliers")
    .select("*")
    .eq("name", "QA-TEST Supplier")
    .maybeSingle();
  if (!supplier) {
    const { data, error } = await admin
      .from("suppliers")
      .insert({
        name: "QA-TEST Supplier",
        balance: 0,
        opening_balance: 0,
      })
      .select("*")
      .single();
    if (error) throw error;
    supplier = data;
  } else {
    await admin
      .from("suppliers")
      .update({ balance: 0 })
      .eq("id", supplier.id);
    supplier.balance = 0;
  }

  const { data: safes } = await admin
    .from("safes")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  const safe = safes?.[0];
  if (!safe) throw new Error("no safe");

  const created = [];
  const results = [];

  async function run(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log("OK", name);
    } catch (e) {
      results.push({ name, ok: false, error: e.message || String(e) });
      console.error("FAIL", name, e.message || e);
    }
  }

  const beforeAll = await snapshot(
    sb,
    product.id,
    customer.id,
    supplier.id,
    safe.id
  );

  await run("sale_cash", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "sale",
      p_items: [
        {
          product_id: product.id,
          quantity: 2,
          unit_price: 20,
          unit_cost: 10,
          discount: 0,
          total: 40,
        },
      ],
      p_subtotal: 40,
      p_total: 40,
      p_paid_amount: 40,
      p_payment_method: "cash",
      p_customer_id: null,
      p_supplier_id: null,
      p_safe_id: safe.id,
      p_notes: "QA-TEST sale cash",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty - 2, `qty ${before.qty}->${after.qty}`);
    assert(
      after.safeBal === before.safeBal + 40,
      `safe ${before.safeBal}->${after.safeBal}`
    );
  });

  await run("sale_credit", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "sale",
      p_items: [
        {
          product_id: product.id,
          quantity: 3,
          unit_price: 20,
          unit_cost: 10,
          discount: 0,
          total: 60,
        },
      ],
      p_subtotal: 60,
      p_total: 60,
      p_paid_amount: 0,
      p_payment_method: "credit",
      p_customer_id: customer.id,
      p_supplier_id: null,
      p_safe_id: null,
      p_notes: "QA-TEST sale credit",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty - 3, `qty`);
    assert(after.custBal === before.custBal + 60, `cust bal`);
    assert(after.safeBal === before.safeBal, `safe unchanged`);
  });

  await run("purchase_cash", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "purchase",
      p_items: [
        {
          product_id: product.id,
          quantity: 5,
          unit_price: 10,
          unit_cost: 10,
          discount: 0,
          total: 50,
        },
      ],
      p_subtotal: 50,
      p_total: 50,
      p_paid_amount: 50,
      p_payment_method: "cash",
      p_customer_id: null,
      p_supplier_id: supplier.id,
      p_safe_id: safe.id,
      p_notes: "QA-TEST purchase cash",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty + 5, `qty`);
    assert(after.safeBal === before.safeBal - 50, `safe`);
  });

  await run("purchase_credit", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "purchase",
      p_items: [
        {
          product_id: product.id,
          quantity: 4,
          unit_price: 10,
          unit_cost: 10,
          discount: 0,
          total: 40,
        },
      ],
      p_subtotal: 40,
      p_total: 40,
      p_paid_amount: 0,
      p_payment_method: "credit",
      p_customer_id: null,
      p_supplier_id: supplier.id,
      p_safe_id: null,
      p_notes: "QA-TEST purchase credit",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty + 4, `qty`);
    assert(after.supBal === before.supBal + 40, `sup bal`);
  });

  await run("sale_return_cash", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "sale_return",
      p_items: [
        {
          product_id: product.id,
          quantity: 1,
          unit_price: 20,
          unit_cost: 10,
          discount: 0,
          total: 20,
        },
      ],
      p_subtotal: 20,
      p_total: 20,
      p_paid_amount: 20,
      p_payment_method: "cash",
      p_customer_id: customer.id,
      p_supplier_id: null,
      p_safe_id: safe.id,
      p_notes: "QA-TEST sale return cash",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty + 1, `qty`);
    assert(after.safeBal === before.safeBal - 20, `safe withdrawal`);
  });

  await run("sale_return_credit", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "sale_return",
      p_items: [
        {
          product_id: product.id,
          quantity: 1,
          unit_price: 20,
          unit_cost: 10,
          discount: 0,
          total: 20,
        },
      ],
      p_subtotal: 20,
      p_total: 20,
      p_paid_amount: 0,
      p_payment_method: "credit",
      p_customer_id: customer.id,
      p_supplier_id: null,
      p_safe_id: null,
      p_notes: "QA-TEST sale return credit",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty + 1, `qty`);
    assert(after.custBal === before.custBal - 20, `cust bal decrease`);
  });

  await run("purchase_return_cash", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "purchase_return",
      p_items: [
        {
          product_id: product.id,
          quantity: 1,
          unit_price: 10,
          unit_cost: 10,
          discount: 0,
          total: 10,
        },
      ],
      p_subtotal: 10,
      p_total: 10,
      p_paid_amount: 10,
      p_payment_method: "cash",
      p_customer_id: null,
      p_supplier_id: supplier.id,
      p_safe_id: safe.id,
      p_notes: "QA-TEST purchase return cash",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty - 1, `qty`);
    assert(after.safeBal === before.safeBal + 10, `safe deposit`);
  });

  await run("purchase_return_credit", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { data, error } = await sb.rpc("create_completed_invoice", {
      p_type: "purchase_return",
      p_items: [
        {
          product_id: product.id,
          quantity: 1,
          unit_price: 10,
          unit_cost: 10,
          discount: 0,
          total: 10,
        },
      ],
      p_subtotal: 10,
      p_total: 10,
      p_paid_amount: 0,
      p_payment_method: "credit",
      p_customer_id: null,
      p_supplier_id: supplier.id,
      p_safe_id: null,
      p_notes: "QA-TEST purchase return credit",
    });
    if (error) throw error;
    created.push(data.id);
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.qty === before.qty - 1, `qty`);
    assert(after.supBal === before.supBal - 10, `sup bal decrease`);
  });

  await run("expense_via_apply_safe_movement", async () => {
    const before = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    const { error } = await sb.rpc("apply_safe_movement", {
      p_safe_id: safe.id,
      p_type: "withdrawal",
      p_amount: 7,
      p_description: "QA-TEST expense probe",
      p_reference_type: "qa_test",
      p_reference_id: null,
    });
    if (error) throw error;
    const after = await snapshot(
      sb,
      product.id,
      customer.id,
      supplier.id,
      safe.id
    );
    assert(after.safeBal === before.safeBal - 7, `expense safe`);
    // reverse
    await sb.rpc("apply_safe_movement", {
      p_safe_id: safe.id,
      p_type: "deposit",
      p_amount: 7,
      p_description: "QA-TEST expense reverse",
      p_reference_type: "qa_test",
      p_reference_id: null,
    });
  });

  // Cleanup created invoices via delete cascade of items; reverse money/stock manually with admin
  // Prefer deleting QA invoices and reversing via stock/balance adjustments
  for (const id of [...created].reverse()) {
    const { data: inv } = await admin
      .from("invoices")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!inv) continue;
    const { data: lines } = await admin
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", id);

    // Reverse stock
    const dir =
      inv.type === "sale" || inv.type === "purchase_return" ? 1 : -1;
    // sale took stock (-), reverse +; purchase gave +, reverse -; sale_return gave +, reverse -; purchase_return took -, reverse +
    const stockDir =
      inv.type === "sale"
        ? 1
        : inv.type === "purchase"
          ? -1
          : inv.type === "sale_return"
            ? -1
            : 1;

    for (const line of lines || []) {
      const { data: p } = await admin
        .from("products")
        .select("quantity")
        .eq("id", line.product_id)
        .single();
      await admin
        .from("products")
        .update({
          quantity: Number(p.quantity) + stockDir * Number(line.quantity),
        })
        .eq("id", line.product_id);
    }

    // Reverse safe txs
    const { data: txs } = await admin
      .from("safe_transactions")
      .select("*")
      .eq("reference_id", id);
    for (const tx of txs || []) {
      const { data: s } = await admin
        .from("safes")
        .select("balance")
        .eq("id", tx.safe_id)
        .single();
      const delta =
        tx.type === "deposit"
          ? -Number(tx.amount)
          : tx.type === "withdrawal"
            ? Number(tx.amount)
            : 0;
      await admin
        .from("safes")
        .update({ balance: Number(s.balance) + delta })
        .eq("id", tx.safe_id);
      await admin.from("safe_transactions").delete().eq("id", tx.id);
    }

    // Reverse party balance remaining
    const remaining = Math.max(0, Number(inv.total) - Number(inv.paid_amount));
    if (remaining > 0) {
      if (inv.type === "sale" && inv.customer_id) {
        const { data: c } = await admin
          .from("customers")
          .select("balance")
          .eq("id", inv.customer_id)
          .single();
        await admin
          .from("customers")
          .update({ balance: Number(c.balance) - remaining })
          .eq("id", inv.customer_id);
      } else if (inv.type === "purchase" && inv.supplier_id) {
        const { data: s } = await admin
          .from("suppliers")
          .select("balance")
          .eq("id", inv.supplier_id)
          .single();
        await admin
          .from("suppliers")
          .update({ balance: Number(s.balance) - remaining })
          .eq("id", inv.supplier_id);
      } else if (inv.type === "sale_return" && inv.customer_id) {
        const { data: c } = await admin
          .from("customers")
          .select("balance")
          .eq("id", inv.customer_id)
          .single();
        await admin
          .from("customers")
          .update({ balance: Number(c.balance) + remaining })
          .eq("id", inv.customer_id);
      } else if (inv.type === "purchase_return" && inv.supplier_id) {
        const { data: s } = await admin
          .from("suppliers")
          .select("balance")
          .eq("id", inv.supplier_id)
          .single();
        await admin
          .from("suppliers")
          .update({ balance: Number(s.balance) + remaining })
          .eq("id", inv.supplier_id);
      }
    }

    await admin.from("invoice_items").delete().eq("invoice_id", id);
    await admin.from("invoices").delete().eq("id", id);
  }

  // cleanup qa_test safe txs
  const { data: qaTxs } = await admin
    .from("safe_transactions")
    .select("*")
    .eq("reference_type", "qa_test");
  for (const tx of qaTxs || []) {
    await admin.from("safe_transactions").delete().eq("id", tx.id);
  }

  await admin
    .from("products")
    .update({ quantity: 1000 })
    .eq("id", product.id);
  await admin.from("customers").update({ balance: 0 }).eq("id", customer.id);
  await admin.from("suppliers").update({ balance: 0 }).eq("id", supplier.id);

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        beforeAll,
        results,
        failed: failed.length,
        createdCount: created.length,
      },
      null,
      2
    )
  );
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
