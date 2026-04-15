# Edge Function API Map

This file maps the API implemented under `deployment/supabase/functions`.
It is based on the handlers themselves, not on external docs or intended product behavior.

## What This API Actually Is

This is not a pure REST API. It is a command-and-event API exposed over HTTP:

- Most gameplay calls are `POST` JSON requests.
- Many endpoints return only an acknowledgement, usually `{"success": true, "request_id": "..."}`.
- The real payload is often delivered as an event, which clients then read back with `events_since`.
- Player identity for gameplay is mostly carried in the request body (`character_id`, `actor_character_id`), not in a per-player JWT.

## Base Paths

- Deployed Supabase route: `/functions/v1/{function_name}`
- Local dev server route: `/{function_name}` or `/functions/v1/{function_name}`
- Local healthcheck: `/health`

The unified local router lives in `deployment/supabase/functions/server.ts`.

## Shared Conventions

### Request / response envelope

- Success responses use JSON with `success: true`
- Errors use JSON with `success: false` and `error`
- Most handlers accept JSON only
- Many handlers generate a `request_id` if the caller does not provide one

### Healthchecks

Most token-gated gameplay/admin endpoints support:

```json
{ "healthcheck": true }
```

Typical response:

```json
{ "success": true, "status": "ok", "token_present": true }
```

### Auth modes

| Mode | Where used | How it works |
| --- | --- | --- |
| Public | `register`, `login`, `forgot-password`, `reset-password`, `user_confirm`, `leaderboard_resources` | No `X-API-Token` required |
| User JWT | `user_character_list`, `user_character_create`, `start` | Uses `Authorization: Bearer <Supabase access token>` |
| App token | Most gameplay endpoints | Uses `X-API-Token`; if `EDGE_API_TOKEN` is unset, local dev allows all requests |
| Admin secret | `character_create`, `character_modify`, `character_delete`, `regenerate_ports`, `reset_ports` | `admin_password` checked against configured admin secret/hash |

### Common gameplay fields

These appear across many token-gated endpoints:

- `character_id`: the target character or corp-ship pseudo-character
- `actor_character_id`: the real player acting on behalf of a corp ship
- `admin_override`: bypasses actor authorization checks
- `task_id`: attached to emitted events for task correlation
- `request_id`: caller-supplied idempotency/tracing handle; generated if omitted

### Actor authorization

`_shared/actors.ts` enforces this model:

- Personal ships: `actor_character_id` must match `character_id` unless `admin_override` is true
- Corporation ships: `actor_character_id` is usually required and must belong to the owning corporation
- Non-ship actions still reject cross-character impersonation unless overridden

### Event-driven endpoints

Three patterns show up repeatedly:

- `Ack`: HTTP returns only an acknowledgement; read the resulting event with `events_since`
- `Sync`: HTTP response contains the full result
- `Sync+event`: HTTP response contains the full result and the handler also emits an event

## Public Account And Session Endpoints

| Endpoint | Method | Auth | Immediate response | Notes |
| --- | --- | --- | --- | --- |
| `register` | `POST` | public | `user_id`, `email`, `email_confirmed`, `message` | Creates a Supabase Auth user; email confirmation may still be required |
| `login` | `POST` | public | `session`, `user`, `characters[]` | Returns Supabase access/refresh tokens plus the user's character list |
| `forgot-password` | `POST` | public | success `message` only | Always succeeds to avoid user enumeration |
| `reset-password` | intended `PUT` | public + recovery `Authorization` token | success `message` | Uses the recovery token to update the user's password |
| `user_confirm` | `POST` | public | `user_id`, `email`, optional `session` | Completes the invite flow using `access_token`, `refresh_token`, `password` |
| `user_character_list` | `GET` or `POST` | Supabase JWT | `characters[]`, `count` | Returns owned characters plus current ship snapshot |
| `user_character_create` | `POST` | Supabase JWT + verified email | `character_id`, `name`, `ship` | Creates a new player-owned character; max 5 per user |
| `start` | `POST /start`, any method on `/start/{id}*` | Supabase JWT | proxied bot response | `POST /start` validates `body.character_id` ownership, then proxies to `BOT_START_URL`; `/start/{id}*` proxies to `/sessions/{id}*` |
| `leaderboard_resources` | `GET` or `POST` | public | `wealth`, `territory`, `trading`, `exploration`, `cached` | 5-minute cached read model; `force_refresh` supported in query string or JSON body |

## Admin And Ops Endpoints

These do not use `X-API-Token`; they rely on `admin_password` instead.

| Endpoint | Mode | Key body | Immediate response | Notes |
| --- | --- | --- | --- | --- |
| `character_create` | Sync | `admin_password`, `name`, optional `player{}`, `ship{}` | created `character_id`, player snapshot, ship snapshot | Internal/admin-only custom character bootstrap |
| `character_modify` | Sync | `admin_password`, `character_id`, optional name/player/ship updates | updated character + ship snapshot | Changing ship type creates a replacement ship |
| `character_delete` | Sync | `admin_password`, `character_id` | `deleted`, `ships_deleted`, `garrisons_deleted` | Calls `delete_character_cascade` and does corporation cleanup |
| `regenerate_ports` | Sync | `admin_password`, optional `fraction` | `ports_regenerated`, `fraction`, `message` | Replenishes port inventory by a fraction of capacity |
| `reset_ports` | Sync | `admin_password` | `ports_reset`, `message` | Resets all ports to initial universe state |

## Test / Local Utility Endpoint

| Endpoint | Mode | Auth | Immediate response | Notes |
| --- | --- | --- | --- | --- |
| `test_reset` | Sync | `X-API-Token` | reset summary + `request_id` | Integration-test helper that clears tables and reseeds fixtures; not part of normal gameplay |

## Core Gameplay Lifecycle And Read Endpoints

Unless noted otherwise, these are `POST` JSON endpoints protected by `X-API-Token`.

| Endpoint | Mode | Key body | Immediate response | Events / notes |
| --- | --- | --- | --- | --- |
| `join` | Ack | `character_id`, optional `sector`, `credits`, `actor_character_id`, `admin_override` | `request_id`, `is_first_visit`, optional `onboarding_route` | Emits `status.snapshot`, `session.started`, `map.local`, and sometimes `combat.round_waiting` |
| `my_status` | Ack | `character_id`, optional `actor_character_id`, `admin_override` | `request_id` | Emits `status.snapshot`; snapshot shape is `{player, ship, sector, corporation}` |
| `move` | Ack | `character_id`, `to_sector` or `to`, optional `actor_character_id`, `admin_override` | `request_id` | Starts movement; emits `movement.start`, later `movement.complete`, `map.update`, `map.local` |
| `character_info` | Sync | `character_id` | `character_id`, `name`, `created_at` | Minimal profile lookup |
| `ship_definitions` | Sync or Sync+event | optional `include_description`, optional `character_id` | `definitions[]` | If `character_id` is supplied, also emits `ship.definitions` |
| `list_user_ships` | Ack | `character_id` | `request_id` | Emits `ships.list` with personal ship plus accessible corporation ships |
| `local_map_region` | Sync+event | `character_id`, optional `center_sector`, `max_hops`, `max_sectors`, `bounds`, `fit_sectors`, `actor_character_id` | `request_id` + map payload | Emits `map.region` |
| `plot_course` | Sync+event | `character_id`, `to_sector`, optional `from_sector`, `actor_character_id` | `request_id`, `from_sector`, `to_sector`, `path[]`, `distance` | Emits `course.plot` |
| `path_with_region` | Ack | `character_id`, `to_sector`, optional `region_hops`, `max_sectors`, `actor_character_id` | `request_id` | Emits `path.region` with path plus local region payload |
| `list_known_ports` | Sync+event | `character_id`, optional `from_sector`, `max_hops`, `port_type`, `commodity`, `trade_type`, `mega`, `actor_character_id` | `request_id` + ports payload | Emits `ports.list`; returns known ports with stock, calculated prices, and hop counts |
| `events_since` | Sync | `character_id` or `character_ids` or `ship_ids` or `corp_id`, optional `since_event_id`, `limit`, `initial_only` | `events[]`, `last_event_id`, `has_more` | Polling endpoint; `ship_ids` are corp-ship pseudo-character ids, not `ship_instances.ship_id` |
| `event_query` | Sync+event | required `start`, `end`; optional `character_id`, `actor_character_id`, `corporation_id`, `event_scope`, `cursor`, `max_rows`, `filter_*`; optional `admin_password` for admin mode | `events[]`, `count`, `has_more`, `next_cursor`, `scope`, `filters`, `request_id` | Historical search endpoint; can also emit `event.query` |

## Corporation Endpoints

These are all `POST` + `X-API-Token`.

| Endpoint | Mode | Key body | Immediate response | Events / notes |
| --- | --- | --- | --- | --- |
| `corporation_list` | Sync | `character_id` | `corporations[]`, `request_id` | Lists active corporations with member counts |
| `corporation_info` | Sync | `character_id`, `corp_id` | corporation payload + `request_id` | Non-members get public fields only; members also get invite code, members, ships, destroyed ships |
| `my_corporation` | Sync | `character_id` | `{ corporation: null }` or full corporation payload + `request_id` | Full member view with `joined_at` |
| `corporation_create` | Sync | `character_id`, `name`, optional `actor_character_id`, `task_id` | `corp_id`, `name`, `invite_code`, `founder_id`, `member_count`, `request_id` | Emits `corporation.created`, `status.update` |
| `corporation_join` | Sync | `character_id`, `corp_id`, `invite_code`, optional `actor_character_id`, `task_id` | `corp_id`, `name`, `member_count`, `request_id` | Emits `corporation.member_joined` |
| `corporation_leave` | Ack | `character_id`, optional `actor_character_id`, `task_id` | `request_id` | Emits `corporation.member_left`; if last member leaves, may emit `corporation.disbanded` / `corporation.ships_abandoned` |
| `corporation_kick` | Ack | `character_id`, `target_id`, optional `actor_character_id`, `task_id` | `request_id` | Emits `corporation.member_kicked` |
| `corporation_rename` | Sync | `character_id`, `name`, optional `actor_character_id` | `name`, `request_id` | Emits `corporation.data` |
| `corporation_regenerate_invite_code` | Sync | `character_id`, optional `actor_character_id` | `new_invite_code`, `request_id` | Emits `corporation.invite_code_regenerated` |

## Economy, Movement, Ships, Salvage, Messaging

These are all `POST` + `X-API-Token`.

| Endpoint | Mode | Key body | Immediate response | Events / notes |
| --- | --- | --- | --- | --- |
| `trade` | Ack | `character_id`, `commodity`, `quantity`, `trade_type`, optional `actor_character_id` | `request_id` | Port trade in current sector; emits `trade.executed`, `port.update`, `status.update` |
| `transfer_credits` | Ack | `from_character_id`, `amount`, and one of `to_player_name` / `to_ship_id` / `to_ship_name`; optional `actor_character_id` | `request_id` | Transfers ship credits to another visible player/ship; emits `credits.transfer`, `status.update` |
| `transfer_warp_power` | Ack | `from_character_id`, `units`, and one of `to_player_name` / `to_ship_id` / `to_ship_name`; optional `actor_character_id` | `request_id` | Transfers warp power; emits `warp.transfer`, `status.update` |
| `bank_transfer` | Mixed | `direction` = `deposit` or `withdraw` | deposit returns transfer/balance summary; withdraw returns `request_id` | Deposit moves ship credits into a player's Megabank balance; withdraw moves bank credits into the caller's active personal ship; emits `bank.transaction`, `status.update` |
| `recharge_warp_power` | Ack | `character_id`, `units`, optional `actor_character_id` | `request_id` | Mega-port service; emits `warp.purchase`, `status.update` |
| `purchase_fighters` | Sync | `character_id`, `units`, optional `actor_character_id` | `request_id`, `units_purchased` | Mega-port service; emits `fighter.purchase`, `status.update` |
| `dump_cargo` | Ack | `character_id`, `cargo` or `items` manifest, optional `actor_character_id` | `request_id` | Dumps cargo into sector salvage; emits `salvage.created`, `sector.update`, `status.update` |
| `salvage_collect` | Sync | `character_id`, `salvage_id`, optional `actor_character_id` | `collected`, `remaining`, `fully_collected` | Picks up a salvage entry from current sector; emits `salvage.collected`, `sector.update`, `status.update` |
| `ship_purchase` | Sync | `character_id`, `ship_type`, optional `purchase_type` (`personal` or `corporation`), `expected_price`, `trade_in_ship_id`, `ship_name`, `initial_ship_credits` | purchase summary + `request_id` | Personal purchases trade in the current ship; corporation purchases create corp ships and emit corp-scoped events |
| `ship_sell` | Sync | `character_id`, `ship_id`, optional `actor_character_id`, `task_id` | `ship_id`, `trade_in_value`, `credits_after`, `request_id` | Sells corporation ships only; the caller's personal ship cannot be sold |
| `ship_rename` | Sync | `character_id`, `ship_name`, optional `ship_id`, `actor_character_id` | `ship_id`, `ship_name`, `changed`, `request_id` | Renames personal or corp ships; emits `ship.renamed`, sometimes `status.update` |
| `send_message` | Sync | `character_id`, `type` (`broadcast` or `direct`), `content`, optional `to_name`, `to_ship_id`, `to_ship_name`, `actor_character_id` | `id` | Emits `chat.message`; direct messages resolve recipients by player name or ship |

## Combat And Garrison Endpoints

These are all `POST` + `X-API-Token`.

| Endpoint | Mode | Key body | Immediate response | Events / notes |
| --- | --- | --- | --- | --- |
| `combat_initiate` | Sync | `character_id`, optional `actor_character_id`, `debug`, `task_id` | `combat_id`, `sector_id`, `round` | Creates combat in current sector; emits `combat.round_waiting` |
| `combat_action` | Sync | `character_id`, `combat_id`, `action`, optional `commit`, `round`, `target_id`, `to_sector`, `destination_sector`, `actor_character_id` | `combat_id` | Submits a combat action; emits `combat.action_accepted` |
| `combat_tick` | Sync | optional empty JSON | `status`, `checked`, `resolved`, `timestamp` | Internal scheduler / cron endpoint that resolves due combat rounds |
| `combat_leave_fighters` | Sync | `character_id`, `sector`, `quantity`, optional `mode`, `toll_amount`, `actor_character_id` | `success: true` | Deploys a garrison; emits `garrison.deployed`, `sector.update`, sometimes `combat.round_waiting` |
| `combat_collect_fighters` | Sync | `character_id`, `sector`, `quantity`, optional `actor_character_id` | `success: true` | Reclaims fighters from a garrison; emits `garrison.collected`, `map.update`, `sector.update`, `status.update` |
| `combat_disband_garrison` | Sync | `character_id`, `sector`, optional `actor_character_id` | `success: true` | Removes a garrison entirely; emits the same family of map/sector/status updates as collection |
| `combat_set_garrison_mode` | Sync | `character_id`, `sector`, `mode`, optional `toll_amount`, `actor_character_id` | `success: true` | Switches garrison mode among `offensive`, `defensive`, `toll`; emits `garrison.mode_changed`, `sector.update` |

## Quest And Task Endpoints

These are all `POST` + `X-API-Token`.

| Endpoint | Mode | Key body | Immediate response | Events / notes |
| --- | --- | --- | --- | --- |
| `quest_assign` | Sync | `character_id`, `quest_code` | `assigned`, optional `player_quest_id`, `request_id` | Assigns via SQL RPC; emits `quest.assigned` and refreshed `quest.status` |
| `quest_status` | Ack | `character_id` | `request_id` | Emits `quest.status` with active/completed quest graph |
| `quest_claim_reward` | Sync | `character_id`, `quest_id`, `step_id` | RPC result + `request_id` | Claims step rewards via SQL RPC |
| `task_lifecycle` | Sync | `character_id`, `task_id`, `event_type` (`start` or `finish`), optional task metadata and ship metadata | `task_id`, `event_type`, `request_id` | Emits `task.start` or `task.finish`; handles corp visibility automatically |
| `task_cancel` | Sync | `character_id`, `task_id` or short prefix | `task_id`, `message`, `request_id` | Emits `task.cancel` after validating ownership or corp authority |

## Architectural Conclusions

### 1. Gameplay auth is app-level, not user-level

The public account endpoints use Supabase JWTs, but the actual game state endpoints mostly do not.
Gameplay calls are guarded by `X-API-Token`, and then the caller selects an in-game actor with `character_id` and sometimes `actor_character_id`.

### 2. Corp ships are modeled as pseudo-characters

Several odd-looking API choices follow from this:

- corp ships can be addressed through `character_id`
- `actor_character_id` tells the server which real player is driving the corp ship
- `events_since.ship_ids` really means corp-ship pseudo-character ids, not `ship_instances.ship_id`

### 3. The intended client loop is HTTP command -> event poll

The normal pattern is:

1. call a token-gated endpoint
2. receive `request_id`
3. poll `events_since`
4. match emitted events on `request_id`

This is especially true for `join`, `my_status`, `move`, `list_user_ships`, `quest_status`, and several economy/combat actions.

### 4. Some endpoints are sync facades over the same event system

`local_map_region`, `plot_course`, `list_known_ports`, `event_query`, `ship_definitions`, and several transaction endpoints return data directly but still emit the corresponding event for async consumers.

### 5. There are a few implementation-level rough edges

- `list_user_ships` throws a plain error on missing character, so the current behavior is closer to `500` than `404`
- `ship_purchase` supports corporation purchases, but the invalid-value error text still says `purchase_type must be 'personal'`
- `user_character_create`'s header comment mentions returning a game JWT, but the implementation returns only character + ship data
- Many token-gated handlers are effectively POST-only by convention rather than by explicit method checks

## Primary Files Consulted

- `deployment/supabase/functions/server.ts`
- `deployment/supabase/functions/_shared/auth.ts`
- `deployment/supabase/functions/_shared/request.ts`
- `deployment/supabase/functions/_shared/actors.ts`
- `deployment/supabase/functions/_shared/status.ts`
- `deployment/supabase/functions/_shared/corporations.ts`
- `deployment/supabase/functions/_shared/pg_queries.ts`
- `deployment/supabase/functions/*/index.ts`
