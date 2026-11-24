# ADR-0002: Deployment na ZimaOS kroz Tailscale, bez javnih portova

Status: predloženo (Faza 0); aktivacija traži odobrenje vlasnika.

## Odluka

- Docker slika se gradi u GitHub Actionsu i objavljuje u privatni GHCR; deploy koristi digest.
- GitHub Actions ulazi u tailnet kao efemerni čvor (`tag:ci-deploy`, OAuth klijent) i poziva jednu ograničenu skriptu preko OpenSSH-a s forced commandom. Nema javnog SSH-a ni self-hosted runnera.
- Aplikacija na ZimaOS-u sluša na `127.0.0.1:3000`; korisnici joj pristupaju preko `tailscale serve` (HTTPS unutar tailneta). Funnel i port forwarding nisu dopušteni bez izričite potvrde vlasnika.
- Baza i kopije su na lokalnom trajnom volumenu `/DATA/AppData/campaign-companion`.
- Prvi deploy je ručan; automatski deploy s `main` uključuje se nakon pilota.

## Posljedice

- Prije korištenja s mobitela potrebna je autentifikacija u aplikaciji (vidi NEDOSLJEDNOSTI N2/O5).
- Korisnik `kdz-deploy` u grupi `docker` ima efektivno root ovlasti; rizik se ograničava forced commandom, `restrict`, Tailscale ACL-om i zasebnim ključem.
- Detalji: [ZimaOS deployment](../operations/zimaos-deployment.md), [CI/CD](../operations/ci-cd.md).
