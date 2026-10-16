# Application packages

Application packages compose the current headless Product Host and project its
canonical Management contract to clients. The external Presentation repository
and independent Machine Operations Plane remain outside this workspace.

| Package                                            | Owns                                                                                |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [product-host](./product-host/README.md)           | Built headless Host process and loopback Management HTTP composition.               |
| [management-client](./management-client/README.md) | Generated-portable ManagementClient and Node local discovery adapter.               |
| [cli](./cli/README.md)                             | The complete reference heptalogos CLI projection.                                   |
| [openclaw-host](./openclaw-host/README.md)         | Independently installed first-party QQ protocol Channel and native custody adapter. |
