import streamDeck from "@elgato/streamdeck";

import { NightscoutAction } from "./actions/nightscout";

// Enable info-level logging to track Nightscout API calls and updates
streamDeck.logger.setLevel("info");

// Register the Nightscout display action
streamDeck.actions.registerAction(new NightscoutAction());

// Connect to Stream Deck
streamDeck.connect();
