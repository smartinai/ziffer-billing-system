alter table xero_quotes
  add column if not exists document_type text not null default 'draft_quote';

update xero_quotes
set document_type = 'draft_quote'
where document_type is null or document_type = '';

create index if not exists idx_xero_quotes_document_type on xero_quotes (document_type);
