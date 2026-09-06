#!/bin/sh
set -eu
uri='mongodb://mongo:27017/admin?directConnection=true'
mongosh --quiet "$uri" --eval '
try { rs.status() } catch (error) {
  if (error.codeName === "NotYetInitialized") {
    rs.initiate({_id:"rs0",members:[{_id:0,host:"mongo:27017"}]})
  } else { throw error }
}'
attempt=0
while [ "$attempt" -lt 60 ]; do
  if mongosh --quiet "$uri" --eval 'quit(db.hello().isWritablePrimary && db.hello().setName === "rs0" ? 0 : 1)'; then exit 0; fi
  attempt=$((attempt + 1)); sleep 1
done
echo 'MongoDB replica set rs0 did not become primary' >&2
exit 1
