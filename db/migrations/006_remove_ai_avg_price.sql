UPDATE shop_candidates
SET card_payload = card_payload - 'avg_price_hint'
WHERE card_payload ? 'avg_price_hint';

UPDATE shops
SET card_payload = card_payload - 'avg_price_hint'
WHERE card_payload ? 'avg_price_hint';

ALTER TABLE shops DROP COLUMN IF EXISTS avg_price_hint;
