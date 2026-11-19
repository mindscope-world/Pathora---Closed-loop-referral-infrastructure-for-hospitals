# Facility integration guide

How a receiving facility's system exchanges referrals and status with Pathora. A programme manager creates a key for the
facility (`POST /api/facilities/:facilityId/api-keys`); the response shows the **API key** and the **signing secret
once**. Store both in your secret manager. Base URL below: `https://<your-pathora-host>/api/integrations/v1`.

## Credentials

| Item | Looks like | Used for |
|---|---|---|
| API key | `pk_<12 chars>.<43 chars>` | `Authorization: Bearer <key>` on **every** request |
| Signing secret | `whsec_<43 chars>` | HMAC signature on every **POST** |

Key permissions (chosen when the key is created):

- `referrals:read` – pull the facility's referrals (FHIR `ServiceRequest` or CSV).
- `referrals:identify` – also include patient names. Without it you receive the programme patient code only. Every
  release of names is recorded in Pathora's audit trail.
- `status:write` – return acknowledge / attendance / outcome.

A key only ever sees and changes **its own facility's** referrals. Revoke a key at any time; it stops working at once.

## Signing a POST

Header: `X-Pathora-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC_SHA256(signingSecret, "<t>." + <exact request body bytes>)`.
Requests more than 5 minutes away from Pathora's clock are refused (replay protection), so keep your clock synced.

```bash
BODY='{"closureReason":"Evaluation complete; benign finding","outcomeSource":"Dr N. Wafula"}'
T=$(date +%s)
SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac "$SIGNING_SECRET" -hex | sed 's/^.* //')
curl -X POST "$BASE/referrals/REF-2026-0418/outcome" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -H "X-Pathora-Signature: t=$T,v1=$SIG" -d "$BODY"
```

## Returning status

Steps happen in order and are never back-filled: **acknowledge → attendance → outcome**. Repeating a step you already
sent returns `200` with `"result":"already_recorded"`, so it is safe to retry after a timeout.

| Call | Meaning |
|---|---|
| `POST /referrals/:ref/acknowledge` | The facility has received the referral |
| `POST /referrals/:ref/attendance` | The patient attended |
| `POST /referrals/:ref/outcome` `{ "closureReason": "...", "outcomeSource": "..." }` | Outcome documented; closes the loop |

FHIR equivalent: `POST /fhir/Task` with `focus.reference = "ServiceRequest/<ref>"` and status `accepted` (or `received`),
`in-progress`, or `completed` (the outcome text goes in `statusReason.text`). Other Task statuses are refused with an
explanation. Errors on `/fhir/*` come back as `OperationOutcome`.

## Pulling referrals

- FHIR: `GET /fhir/ServiceRequest?status=active|completed&_count=1..100` (follow the `next` link), `GET /fhir/ServiceRequest/:ref`,
  `GET /fhir/Task/:ref`, and `GET /fhir/metadata` (no key needed).
- CSV (for portal-and-spreadsheet facilities): `GET /referrals.csv` lists open referrals.
- CSV status upload: `POST /status-returns.csv` (signed, `Content-Type: text/csv`) with columns
  `Referral ID,Status,Closure Reason,Outcome Source`, where Status is `ACKNOWLEDGED`, `ATTENDED` or `CLOSED`. Up to 500
  rows; each row is applied independently and reported (`applied`, `already_recorded` or `error` with a reason).

## Limits and errors

Per key: 300 requests/minute. Repeated failed authentication from one address is throttled. `401 INVALID_API_KEY` is the same
answer for an unknown, wrong, revoked or expired key. `401 INVALID_SIGNATURE` says whether the signature is missing,
malformed, stale or does not match the body. `403 INSUFFICIENT_SCOPE` means the key lacks the needed permission.
`409 ILLEGAL_TRANSITION` means the step is out of order. `404` is also what you get for another facility's referral.

## Not provided yet

Pathora does not push referrals to you (you pull them), and there is no hosted SFTP drop; the CSV endpoints above are the
file-based route. See `plan.md` Phase 10.
