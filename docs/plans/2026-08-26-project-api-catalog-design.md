# Project API Catalog Design

Forge UI will isolate imported API descriptions by Project. A Project can contain multiple API Documents, while each document owns its OpenAPI summary, base URL, authorization allow-list, enabled state, and credential reference.

Users explicitly select the enabled API Documents used for each generation request. The selection is remembered per Project. Generated operation bindings include `apiDocumentId`, so identical operation IDs in different documents remain distinct. Runtime requests resolve configuration from the persisted Project and API Document rather than trusting client-supplied credentials.

Generated Pages, Templates, and Generation Sessions belong to exactly one Project. Cross-project reuse is copy-based rather than shared ownership. Deleting an API Document is blocked while a saved Template or Generation Session references it; the error identifies the referencing artifacts. Existing singleton connection data migrates into a Default Project without losing templates, history, authorization, or credential references.

The sidebar provides the current Project selector and project management commands. The OpenAPI view lists and manages documents in the current Project. The generation view presents an explicit multi-document selection before generation. Business connection settings edit the currently selected API Document.

