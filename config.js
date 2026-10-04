// Settings for Splash Royale. You can deploy without changing anything here.

window.GAME_CONFIG = {
  // Options passed to PeerJS, the library that connects the players' browsers.
  // Leave this empty to use the free PeerJS cloud server.
  peerOptions: {},

  // Some mobile and office networks block direct connections between players.
  // A TURN relay fixes that. Easiest free option: create an app at metered.ca,
  // open "TURN Server" > "Credentials", and paste the "fetch credentials" URL here.
  // It looks like https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=...
  turnCredentialsUrl: "",

  // Room names on the connection server start with this, so they don't clash
  // with other sites using the same free server. Change it to anything unique
  // if you run your own copy of the game.
  idPrefix: "splashroyale-",

  // How many public Quick Play islands to look through before giving up.
  quickRooms: 30
};
