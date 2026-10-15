UPDATE subscription_plans SET
  stripe_price_id_monthly = 'price_1ThY3wJEJHJ1jQ36qiVrlhYp',
  stripe_price_id_annually = 'price_1ThYLiJEJHJ1jQ36Dt7rdCaK'
WHERE plan_key = 'starter';

UPDATE subscription_plans SET
  stripe_price_id_monthly = 'price_1ThYEiJEJHJ1jQ36MayNgN41',
  stripe_price_id_annually = 'price_1ThYLHJEJHJ1jQ36h6pPH5gL'
WHERE plan_key = 'professional';

UPDATE subscription_plans SET
  stripe_price_id_monthly = 'price_1ThYH5JEJHJ1jQ36giYJPmIU',
  stripe_price_id_annually = 'price_1ThYKbJEJHJ1jQ36NhZTdeFx'
WHERE plan_key = 'enterprise';
