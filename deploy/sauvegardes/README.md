# Sauvegardes

- `sauvegarde.sh` : tourne toutes les heures sur le serveur (cron `/etc/cron.d/shadowrun-backup`, scripts dans `/root/shadowrun-backup/`, archives dans `/var/backups/shadowrun/`). Archive `/var/shadowrun` (YAML, carte sans `source/`) + `app.db` (copie SQLite cohérente) + `uploads/`.
- `rotation.sh` : garde 7 horaires, 3 journalières, 2 hebdomadaires, 3 mensuelles, 2 annuelles (variables `HORAIRES`, `JOURNALIERES`, `HEBDO`, `MENSUELLES`, `ANNUELLES`). Test à blanc : `rotation.sh <dossier> --dry-run`.
- `recuperer.sh` : à lancer depuis le PC (Git Bash), copie les nouvelles archives dans `~/sauvegardes-shadowrun` et applique la même rotation.

## Restaurer

```bash
scp quarantaine:/var/backups/shadowrun/shadowrun-AAAAMMJJ-HHMMSS.tar.gz .
mkdir restore && tar -xzf shadowrun-*.tar.gz -C restore
# restore/ = contenu de /var/shadowrun ; restore/data/ = app.db + uploads (volume Docker)
```

Mettre le site à l'arrêt avant de remplacer `app.db` / `uploads/`, puis `chown -R 1000:1000`.
