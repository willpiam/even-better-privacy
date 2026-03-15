select
  identities.fingerprint,
  name_detail.detail as name,
  email_detail.detail as email
from identities
left join details as name_detail
  on name_detail.identity_fingerprint = identities.fingerprint
  and name_detail.path = 'name'
left join details as email_detail
  on email_detail.identity_fingerprint = identities.fingerprint
  and email_detail.path = 'email';

select * from identities;

-- list all tables