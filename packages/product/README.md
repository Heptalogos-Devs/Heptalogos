# Product packages

This group contains current Product semantic owners that compose on top of
Foundation mechanics:

- [`@heptalogos/identity`](./identity/README.md) owns opaque Host Entities and
  formal account, UID, group and Subject self associations.
- [`@heptalogos/messaging`](./messaging/README.md) owns native MessageFacts,
  ordered parts, material state, pending references and scoped reading.
- [`@heptalogos/subject`](./subject/README.md) owns persistent Subject
  authority and the bounded L4 conversation communication path from Reaction
  through optional CommunicationCommit, Expression, and local reply.

Messaging and Identity remain independent of Subject implementation. The Host
provides the current fenced Activity; Channel owns protocol work and the Life
consumer decides actual contact.
