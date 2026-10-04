# Splash Royale

A free water-balloon battle royale that runs in the browser. Everyone floats down onto a cartoon island, grabs water balloons and soakers, and tries to be the last one dry while a rain storm shrinks the island.

No installs, no accounts, no payments, no game server.

## How it plays

- **Quick Play** puts you on a public island with whoever else is looking for a match. After 20 seconds the match starts, and bots fill the empty spots so it's fun even alone.
- **Create room** makes a private room with a code and an invite link for friends (up to 12 people). The person who made it presses **Start**, can turn bots on or off, and can pick **Solo**, **Duos** or **Squads**. Teammates land together, can't splash each other and win together.
- **Practice** plays a match against bots straight away, even without internet.
- **Weapons:** water balloons (unlimited, arc over walls), **Soakers** (rapid fire, stopped by walls) and **Mega balloons** (huge splash). **Towels** dry you off and **Bubbles** soak up the next splashes for you.
- **Bushes** hide you from everyone until you throw something or someone walks right up to you.
- **Supply drops** float down into the safe zone twice a match. Whoever reaches one first gets full dryness, a bubble and lots of ammo.
- **Hats:** cap, crown, bunny ears, flower, propeller, party hat, frog and duck.
- **Four kinds of island:** sunny, autumn, snowy and candy, each with trampolines that bounce you high into the air.
- **Warm up while you wait:** run around the next island and practise throwing in the lobby.
- **The storm** shrinks in 5 stages. Outside the circle the rain soaks you a little more every second.
- **Last one dry wins.** You can watch the rest of the match after you're out, and a new round starts automatically.
- Name tags, dryness bars, a minimap, a kill feed, emotes (👋 😂 😎 …), splash effects, sounds and screen shake.
- Your wins, games and splashes are remembered on your device.
- It can be installed on a phone with **Add to Home Screen** and opens full screen.

**Controls on a computer:** WASD to move, mouse to aim, click to throw, 1/2/3 or the mouse wheel to switch weapons, Space to jump, Shift or right-click to dash, E to wave.

**Controls on a phone:** left thumb to walk; drag the right thumb to aim and let go to throw. Tap the right side to throw at the nearest player. Buttons on the right switch weapons, dash and jump.

## Deploy (free)

The game is a plain static site: no build step, no backend, no database.

1. Go to [vercel.com](https://vercel.com), sign in with GitHub, and choose **Add New → Project**.
2. Import the **Game-Felimonyo** repository.
3. Leave the framework preset as **Other** and the build settings empty, then press **Deploy**.
4. Your game is live at `your-project.vercel.app`. Every push to `main` updates it automatically.

It also works on any other free static host (Netlify, Cloudflare Pages, GitHub Pages).

**Before sharing it widely:**

- Open `config.js` and change `idPrefix` to something unique to you (for example `splashroyale-yourname-`). Players only meet others who use the same prefix.
- Add a free TURN relay so players on strict networks (some mobile data and school or office Wi-Fi) can connect: sign up at metered.ca, create an app, open **TURN Server**, and paste the credentials URL into `turnCredentialsUrl` in `config.js`.

To try it on your own computer: `npx serve .` in this folder and open the address it prints.

## How it works

| File | What it does |
| --- | --- |
| `index.html` | Menu, lobby, HUD and results screens |
| `style.css` | Look and layout, including the phone controls |
| `config.js` | Connection settings |
| `js/main.js` | Menu, connecting and the animation loop |
| `js/net.js` | Matchmaking: Quick Play islands and private rooms |
| `js/host.js` | Runs the match: hits, storm, pickups, bots, snapshots |
| `js/game.js` | One player's view: movement, aiming, HUD, minimap |
| `js/render.js` | The 3D world, characters and effects (three.js) |
| `js/shared.js` | Island generator, physics and rules that every browser shares |
| `js/input.js` | Keyboard, mouse and thumb sticks |
| `js/audio.js` | Sound effects made in the browser |
| `vendor/` | three.js 0.170 and PeerJS 1.5.5 |

- **No game server.** Players connect directly to each other with WebRTC through PeerJS. One player's browser (whoever opened the room or island first) acts as the host and runs the match for everyone. The free PeerJS cloud server only introduces players to each other.
- **Same island everywhere.** The host sends one random number and every browser builds the identical island, trees, houses, pickups and storm path from it.
- **Smooth movement.** You move your own character instantly. The host decides who got splashed and sends everyone the positions of all players 15 times a second, and other players are drawn slightly in the past so they glide smoothly.
- **Quick Play** looks for public islands named `qp-1`, `qp-2`, … on the PeerJS server. If island 1 has no host you become its host; if it's full you try island 2.

## Good to know

- **If the host leaves, the match carries on.** The player who has been in the room longest takes over as host and everyone reconnects automatically, keeping their character, dryness and ammo. If the host's tab is in the background the match keeps running, but their own character stands still.
- **Up to 12 people per room**, and as many rooms as you like. Bigger matches would need a paid game server.
- **The free PeerJS server** is a shared community service with no uptime guarantee. If the game gets popular, run your own PeerServer (free, open source) and put its address in `peerOptions` in `config.js`.
- **It's a friendly game, not an esport.** Each browser reports its own position, so someone determined could cheat in their own rooms.

## Ideas for later

- More islands (snow, candy, beach town) and weapons (sprinklers, water bombs)
- Teams (duos and squads)
- Character hats and skins
- A shared leaderboard (needs a free database such as Supabase)
