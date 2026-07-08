with allowed_clients(display_name) as (
  values
    ('2BE Investments SCS - B305040 - 20.02.2026'),
    ('Aacht S.à r.l.  B258296'),
    ('AK Investment S.A. SPF'),
    ('AP Investments S.A. SPF'),
    ('ASOTO Group S.A.'),
    ('AVL Investments S.A. SPF'),
    ('BioLogistigue S.A.'),
    ('Boris Zimin SPF B227718'),
    ('CAOG S.à r.l. - B167988 - 22.03.2012'),
    ('CQD S.à r.l. - B277186'),
    ('DOM Invest Sarl SPF (BILL EVERYTHING IN ADVANCE) : B282885'),
    ('Family office Balabanov'),
    ('GMD-Invest S.a.r.l. - B257573'),
    ('Grebble S.A - B251.180 - 04.01.2021'),
    ('INNOWISE S.A. - B300626'),
    ('KPS Holding S.A.'),
    ('LBI International Holding S.ar.l.'),
    ('LVL Group S.à r.l - B184388'),
    ('MAOF CAPITAL Sarl'),
    ('Meracle Health (Luxembourg) Sarl'),
    ('MERMAN Investments S.ar.l. SPF (former YM investments)'),
    ('Microfininvest S.A.'),
    ('MRP Invest S.à r.l., SPF - B 266 880'),
    ('MTML Investments S.A., SPF - B222703 - 08.03.2018'),
    ('Naluri Therapeutics (Euro) S.a r.l.'),
    ('NatEast Investment S.A., B233652, SPF 05.04.2019'),
    ('NGE Industry S.A.'),
    ('Nightingale Invest S.à r.l., SPF  Numéro RCS : B280383'),
    ('OSTD Investments S.A. SPF'),
    ('OVI Sarl, SPF'),
    ('PI Investments S.A. SPF'),
    ('Rose Consulting S.à r.l.'),
    ('SABYR S.A. - B263370'),
    ('Sanet Investments S.C.S.'),
    ('Sanet Management Sarl'),
    ('SARA S.ar.l. SPF - B277740'),
    ('Secure Affiliate Payouts limited'),
    ('Sensorflow Europe S.à r.l.'),
    ('STS Investment SA - B224672'),
    ('Systema AP S.A.'),
    ('TDINVEST S.A. SPF'),
    ('Thema Production S.A.'),
    ('TUMD Luxembourg S.ar.l. - B 220.440 - 15.12.2017'),
    ('Vanetsyan Family Investments S.á r.l., SPF - B306073 - 7/02/2026'),
    ('VIMAR CAPITAL - B 269 577'),
    ('VKH Investments S.A. SPF - B 217 600 - 30.08.2017'),
    ('Vladalog SPF Sarl'),
    ('VNX S.A. - B228.646 - 15.10.2018'),
    ('VSPE S.ar.l. - B293876 - 14.02.2025'),
    ('ZEQ Sarl SPF - B249389')
),
classified_clients as (
  select client.id, allowed_clients.display_name is not null as is_allowed
  from billing_clients client
  left join allowed_clients on allowed_clients.display_name = client.display_name
)
update billing_clients client
set
  active = classified_clients.is_allowed,
  status = case when classified_clients.is_allowed then 'active' else 'excluded' end,
  updated_at = now()
from classified_clients
where client.id = classified_clients.id;
