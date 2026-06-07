# supernote-sync-local

A simple CLI tool to sync files and notes between a computer and a Supernote device on the same WiFi network.

## Install dependencies

```bash
bun install
```

## Setup environment

1. Create a `.env` file
   - Make a copy of `.env.example` and rename it to `.env`
2. Setup device details
   - Turn on WiFi transfer on your Supernote device, this will pop up the local IP address of your device
   - Fill in the `SUPERNOTE_IP` and `SUPERNOTE_PORT` in the `.env` file.
3. Setup local data directory
   - Add a `supernote` folder to the top level of the project directory
     - This is used by `LOCAL_PATH` and `DB_PATH`
4. Choose the folders on your Supernote device you want to sync
   - Update `SYNC_DIRS` in the `.env` file

## Running

WiFi transfer must be toggled on the Supernote device.

```bash
bun run index.ts
```

## Mac gotchas

If running on a Mac the terminal you are running on may not have `Local Network` permissions. This shows up as a very opaque error.

- In `Privacy & Security -> Local Network` ensure your running terminal has permission.
