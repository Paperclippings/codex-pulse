# Codex Pulse for BridgeThing

A four-screen Car Thing dashboard for local Codex chats, unanswered prompts, recent token counts, and account usage limits. A BridgeThing desktop extension reads the local Mac account and forwards snapshots to the device. It does not send Codex credentials to the Car Thing or to this repository.

## Requirements

- A Car Thing running BridgeThing 0.12.1 or later, linked to BridgeThing Desktop on a Mac
- Codex activity stored in the current Mac user's `~/.codex` directory
- ChatGPT.app in `/Applications` for account usage limits (the other screens can work without it)

BridgeThing asks for these extension permissions during installation: read `HOME`, read `~/.codex/sessions`, run `/usr/bin/sqlite3`, and run the Codex CLI bundled in ChatGPT.app. The extension only queries local Codex data and asks the CLI for `account/rateLimits/read`. Review these permissions before installing.

## What works

- Recent local Codex task titles and whether their latest recorded turn is running
- A count of local task threads with an unanswered Codex question
- Remaining percentage and reset time for the Codex short and weekly usage windows
- Automatic refresh every 60 seconds
- Four screens, selected with preset buttons 1–4 or horizontal swipes

The Needs You indicator counts task threads with a stored question and no later user message. This is a useful local signal, but it is not the desktop app's full live attention state. The official Codex app-server reports live attention flags only for threads loaded in that same server process. Starting a second app-server for this extension returns those desktop threads as notLoaded. ChatGPT Work cloud chats are also outside the local SQLite task list.

## Install

Download the newest `Codex-Pulse-<version>.zip` from [Releases](https://github.com/Paperclippings/codex-pulse/releases), then in BridgeThing Desktop open **Store → Install a local bundle** and select the zip. Keep BridgeThing Desktop running and linked to the Car Thing for live data.

Once the [Codex Pulse catalog](https://paperclippings.github.io/codex-pulse/catalog.json) is live, you can add that URL as a source in BridgeThing Desktop's Store and install from there. Catalog listings are reviewed separately by BridgeThing.

## Build

From this directory:

    bun install
    bun run check

The app bundle is written to `apps/codex-pulse/dist`. Run `bun run --cwd apps/codex-pulse share` to package it as a local-install zip.

## Run on the Car Thing

Run `bun run dev:device` from this directory to test the page and extension together. You can also run `bun run dev` to view the page in a browser. Add `?demo=1` to the page URL for a layout preview without a connected device.

## Data access

The extension never writes to Codex task data. The database file names and schema are private implementation details of the current Codex app and may need updating after an app release. The Needs You count is inferred from locally stored questions, so it can differ from the desktop app's live attention state. ChatGPT Work cloud chats are outside the local task list.

Do not install this extension from a source you do not trust: its Codex CLI subprocess inherits your local account session.
