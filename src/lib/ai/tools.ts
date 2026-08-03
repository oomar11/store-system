import {
  SchemaType,
  type FunctionDeclaration,
  type FunctionDeclarationSchemaProperty,
} from "@google/generative-ai";

const periodProps: {
  period: FunctionDeclarationSchemaProperty;
  from: FunctionDeclarationSchemaProperty;
  to: FunctionDeclarationSchemaProperty;
} = {
  period: {
    type: SchemaType.STRING,
    description:
      "الفترة: today | 7days | month | custom. الافتراضي today إن لم يُحدد.",
  },
  from: {
    type: SchemaType.STRING,
    description: "تاريخ البداية YYYY-MM-DD عند period=custom",
  },
  to: {
    type: SchemaType.STRING,
    description: "تاريخ النهاية YYYY-MM-DD عند period=custom",
  },
};

export const businessTools: FunctionDeclaration[] = [
  {
    name: "get_business_overview",
    description:
      "ملخص شامل للبيزنس في فترة: مبيعات صافية، ربح، تحصيل، ديون، مخزون، مصروفات، نقص أصناف.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: { ...periodProps },
    },
  },
  {
    name: "get_sales_report",
    description:
      "تقرير مبيعات ومرتجعات لفترة: إجماليات، أفضل أصناف وعملاء، قائمة فواتير مختصرة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        ...periodProps,
        limit: {
          type: SchemaType.INTEGER,
          description: "حد أقصى لعدد الفواتير في القائمة (افتراضي 15)",
        },
      },
    },
  },
  {
    name: "search_products",
    description: "بحث عن أصناف بالاسم أو SKU مع الكمية والأسعار.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "نص البحث (اسم أو كود)",
        },
        limit: {
          type: SchemaType.INTEGER,
          description: "عدد النتائج (افتراضي 15)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_stock",
    description:
      "حالة المخزون: ملخص أو أصناف منخفضة/نافدة، أو تفاصيل صنف بالاسم/الكود.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "اختياري: اسم أو كود صنف محدد",
        },
        filter: {
          type: SchemaType.STRING,
          description: "all | low | out — افتراضي all",
        },
        limit: {
          type: SchemaType.INTEGER,
          description: "حد النتائج (افتراضي 20)",
        },
      },
    },
  },
  {
    name: "get_low_stock",
    description: "قائمة الأصناف تحت الحد الأدنى التي تستحق تنبيهاً.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.INTEGER,
          description: "حد النتائج (افتراضي 30)",
        },
      },
    },
  },
  {
    name: "search_parties",
    description: "بحث عملاء أو موردين بالاسم/الهاتف مع الأرصدة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "نص البحث",
        },
        type: {
          type: SchemaType.STRING,
          description: "customer | supplier | all — افتراضي all",
        },
        limit: {
          type: SchemaType.INTEGER,
          description: "حد النتائج لكل نوع (افتراضي 10)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_party_detail",
    description:
      "تفاصيل طرف (عميل/مورد): الرصيد وآخر فواتير مرتبطة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        name: {
          type: SchemaType.STRING,
          description: "اسم الطرف أو جزء منه",
        },
        type: {
          type: SchemaType.STRING,
          description: "customer | supplier | auto — افتراضي auto",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "search_invoices",
    description: "بحث فواتير بيع/شراء برقم أو طرف أو فترة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "رقم فاتورة أو اسم طرف",
        },
        invoice_type: {
          type: SchemaType.STRING,
          description:
            "sale | purchase | sale_return | purchase_return | all — افتراضي all",
        },
        ...periodProps,
        limit: {
          type: SchemaType.INTEGER,
          description: "حد النتائج (افتراضي 15)",
        },
      },
    },
  },
  {
    name: "get_treasury",
    description: "أرصدة الخزائن وحركات الفترة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        ...periodProps,
        limit: {
          type: SchemaType.INTEGER,
          description: "حد الحركات (افتراضي 20)",
        },
      },
    },
  },
  {
    name: "get_expenses",
    description: "مصروفات الفترة مع الإجمالي.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        ...periodProps,
        limit: {
          type: SchemaType.INTEGER,
          description: "حد النتائج (افتراضي 20)",
        },
      },
    },
  },
  {
    name: "get_shifts",
    description: "الوردية المفتوحة حالياً و/أو آخر الورديات المغلقة.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        include_recent: {
          type: SchemaType.INTEGER,
          description: "عدد الورديات المغلقة الأخيرة (افتراضي 3)",
        },
      },
    },
  },
  {
    name: "global_search",
    description:
      "بحث سريع شامل في الأصناف والعملاء والموردين وفواتير البيع/الشراء.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "نص البحث",
        },
      },
      required: ["query"],
    },
  },
];
