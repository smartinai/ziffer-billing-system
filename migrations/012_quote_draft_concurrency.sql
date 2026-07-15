create unique index if not exists idx_quote_previews_document_number_unique
  on quote_previews (document_type, lower(quote_number))
  where quote_number <> '';

create index if not exists idx_quote_previews_editor_session
  on quote_previews (editing_by, editing_session_id)
  where editing_by is not null and editing_session_id is not null;
