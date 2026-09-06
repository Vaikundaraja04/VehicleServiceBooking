# Windows setup

Use [START_HERE.md](START_HERE.md) for this release.

`npm start` now starts the persistent MERN application with real Gmail. On its first run, edit the generated `server/.env` to supply `GMAIL_USER` and `GMAIL_APP_PASSWORD`. Run again and sign in with `GMAIL_USER` and the initial `ADMIN_PASSWORD` from that file.

`START_HERE_WINDOWS.bat` runs the same command. If the app does not start, the window remains open so you can read the error.

The old disposable demo is still available as `npm run demo`. Its synthetic login credentials and temporary database are for that command only. It is not the default real-Gmail workflow.

For separate server/client processes or an external MongoDB replica set, use the advanced instructions in README.md.
