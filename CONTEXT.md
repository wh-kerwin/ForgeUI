# Forge UI Domain

Forge UI turns authorized API descriptions into locally stored, runnable business pages. Projects keep unrelated API catalogs and generated artifacts isolated.

## Language

**Project**:
A workspace that owns API Documents, Generated Pages, Templates, and Generation Sessions. An artifact belongs to exactly one Project.
_Avoid_: Folder, group, tenant

**API Document**:
One imported Swagger or OpenAPI specification together with its service address, authorization allow-list, and credential reference. A Project can own multiple API Documents.
_Avoid_: Global business connection, API file

**Generation Selection**:
The enabled API Documents a user explicitly chooses for one generation request. The most recent selection is remembered per Project.
_Avoid_: Automatic API discovery

**Operation Binding**:
A Generated Page reference to one authorized operation in one API Document. Its identity includes the API Document, method, path, and operation ID.
_Avoid_: Operation ID alone

**Generated Page**:
A PageSpec produced in a Project and bound only to API Documents from that Project.
_Avoid_: Cross-project page

**Template**:
A saved, versioned Generated Page that belongs to one Project.
_Avoid_: Global template

