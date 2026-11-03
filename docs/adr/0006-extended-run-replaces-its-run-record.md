# An Extended Run replaces its Run record

Status: accepted.

A Run of a Plan provider can end with `plan limit` long before its Token limit. A Continued Run could play on, but it is a new Run: it has a new id, so the Race draws another Ghost face, and the old file stays. We want one Run to stay one Run over a renewal of the quota, so a checkbox "Keep the same Run" plays on from a Run record and replaces its file under the same name.

Until now a Run record never changed after its Run. We accept this change because the new record holds all the buttons and events of the old one, and the Harness refuses to start when the replay does not give the same Game events. The header takes the new Bot and limit, so its `parts` keep the Bot, the Run result and the end of each earlier part. The file is written next to the old one and then renamed, so a crash leaves the old file whole. The file at the old stop is lost: after the replacement, no Run can branch from that stop. A record that has a Continued Run cannot extend, so a person selects one of the two at each stop.

We rejected a pause of the Run: it holds one of the places of the pool, it lives only in memory, and ADR 0005 says that a Run does not wait, so that it never uses quota with no request from a person. We also rejected a new file with the same id for each part: the same number would have two files, and the list of records, `bun run race <id>` and the file names would all have to choose between them.

A Continued Run finds its start from the end of its parent, so a Run record that another record names as its parent cannot extend. The limit of each part counts from 0, as for a Continued Run: a person restarts it on purpose.
