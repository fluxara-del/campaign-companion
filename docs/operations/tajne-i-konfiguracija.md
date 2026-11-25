# Tajne i konfiguracija (samo nazivi, bez vrijednosti)

## GitHub — environment `production`

| Naziv | Vrsta | Namjena |
|---|---|---|
| `TS_OAUTH_CLIENT_ID` | secret | Tailscale OAuth klijent (opseg `auth_keys`, samo `tag:ci-deploy`) |
| `TS_OAUTH_SECRET` | secret | Tajna istog OAuth klijenta |
| `DEPLOY_SSH_PRIVATE_KEY` | secret | Privatni ed25519 ključ samo za deploy (forced command na serveru) |
| `DEPLOY_SSH_KNOWN_HOSTS` | secret | Pinirani host key ZimaOS-a (sprječava MITM) |
| `DEPLOY_HOST` | variable | MagicDNS ime ZimaOS-a u tailnetu |
| `DEPLOY_USER` | variable | `kdz-deploy` |

Environment treba ograničiti na granu `main` i, ako plan dopušta, uključiti *required reviewers* (vlasnik).

## GitHub — varijable repozitorija (prekidači)

| Naziv | Zadano | Učinak |
|---|---|---|
| `DEPLOY_ENABLED` | nije postavljeno | `true` dopušta ručni deploy/rollback |
| `AUTO_DEPLOY_ENABLED` | nije postavljeno | `true` dopušta automatski deploy nakon uspješnog CI-a na `main` (tek nakon pilota) |

`GITHUB_TOKEN` (automatski) koristi se za push slike u GHCR s `packages: write` samo u build jobu.

## ZimaOS — samo na serveru

| Naziv | Gdje | Namjena |
|---|---|---|
| GHCR token (`read:packages`) | `docker login ghcr.io` korisnika `kdz-deploy` | Povlačenje privatne slike |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PROVIDER`, `AI_MODEL` | `config/app.env` (chmod 600) | AI DM (Faza 5) |
| `SESSION_SECRET`, `APP_ORIGIN` | `config/app.env` | Autentifikacija i CSRF/origin provjera (prije mobilnog pristupa) |
| `TZ` | `config/app.env` | Prikaz vremena (`Europe/Zagreb`) |

AI ključevi namjerno **nisu** u GitHub Secrets: CI ih ne treba, a ovako ne prolaze kroz runner.

## Pravila

- Vrijednosti se nikad ne ispisuju u logove; workflowi ih prosljeđuju samo kroz `env` i datoteke s ograničenim pravima.
- Rotacija: deploy ključ i Tailscale OAuth tajna barem jednom godišnje i odmah nakon sumnje na kompromitaciju.
- Lokalno: `.env` (ignoriran), predložak je `.env.example`.
