-- Opening / catalog cost when buy was never set: use sell − 10% (trade discount).
-- Many products had buy_price copied from sell_price, so any customer discount
-- looked like a loss. Reprice those to the default estimated cost.
-- Products that already have a real buy below sell are left unchanged.
-- Sale-line unit_cost cleanup: see 20260804_sale_unit_cost_from_sell_estimate.sql

UPDATE products
SET buy_price = ROUND(sell_price * 0.9, 2)
WHERE sell_price > 0
  AND (
    buy_price = 0
    OR buy_price = sell_price
  );
