# Pstack CLI

Une adaptation indépendante du [Pstack de Lauren Tan pour Cursor](https://github.com/cursor/plugins/tree/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack). Elle conserve ses compétences, ses playbooks et les recommandations de son setup, mais lance les agents dans **leurs propres CLI** (Claude Code, Codex, OpenCode ou Pi), chacune dans un workspace [Herdr](#prerequis) distinct. Ce n'est pas une version officielle de Cursor, de Lauren Tan ou de Herdr.

## Démarrer en quatre commandes

Il faut d'abord installer [Bun](https://bun.sh/), Herdr (`herdr` sur le `PATH`, ou `HERDR_BIN_PATH`) et au moins une des quatre CLI ci-dessus, **déjà connectée** à son propre compte. Ce dépôt n'installe ni Herdr ni les CLI des fournisseurs.

Dans PowerShell :

```powershell
git clone https://github.com/charlescstpierr/pstack-cli.git
cd pstack-cli
bun install
bun src/onboard.ts
```

L'assistant interactif `bun src/onboard.ts` :

1. Affiche **toujours** les recommandations officielles de Lauren Tan pour les 17 rôles, les budgets et les choix déjà enregistrés.
2. Détecte Claude Code, Codex, OpenCode et Pi sur le `PATH`. Tu choisis un rôle par numéro, une CLI installée par numéro, puis **un identifiant de modèle que ta CLI accepte**. Les noms de modèles Cursor recommandés en amont ne sont pas automatiquement valables dans les autres CLI.
3. Enregistre ton choix et te propose de lancer un premier agent. Si tu acceptes, donne le chemin absolu d'un dossier existant et la tâche à accomplir. Tu peux refuser et démarrer un agent plus tard.

L'onboarding est relançable pour configurer d'autres rôles. Il ne remplace pas la CLI complète. Pour une configuration isolée, utilise `bun src/onboard.ts --config C:\chemin\vers\config.json` et repasse ce chemin aux commandes avancées.

### Retrouver l'agent après le premier lancement

`run` affiche un nom `pstack-...`, un workspace et un pane Herdr. Remplace `pstack-...` par ce nom :

```powershell
bun src/index.ts status
bun src/index.ts read pstack-...
bun src/index.ts resume pstack-... --prompt "Continue la tâche"
```

Ces commandes exigent que le workspace Herdr et la CLI soient encore en cours d'exécution. `resume` vérifie le workspace, le pane, le terminal, le nom et la CLI avant d'envoyer le prompt. Il ne relance pas un processus fermé.

### Sans assistant

```powershell
bun src/index.ts detect
bun src/index.ts setup
bun src/index.ts setup --role "bug-fix" --kind codex --model "MODELE_ACCEPTÉ_PAR_CODEX"
bun src/index.ts run --role "bug-fix" --cwd "C:\chemin\vers\ton-projet" --prompt "Corrige ce bogue" --skill tdd
```

`setup` affiche les recommandations de Lauren Tan, même avec `--config PATH` et même après avoir enregistré des rôles. Il ne vérifie **pas** l'accès au modèle : commence par essayer le modèle dans la CLI choisie. Chaque CLI utilise sa propre connexion ; Pstack CLI ne demande ni ne conserve de clé API.

Pour rendre les commandes plus courtes, `bun link` dans ce dossier enregistre `pstack-init` (l'assistant) et `pstack-cli` (les commandes avancées), à condition que le dossier global des binaires Bun soit sur le `PATH`. Sinon, les commandes `bun src/onboard.ts` et `bun src/index.ts` fonctionnent directement. `bun run build` produit aussi `dist/onboard.js` et `dist/index.js`.

Le [guide détaillé](docs/usage.md) couvre la configuration, `run`, `read`, `resume`, les compétences, les playbooks et les scripts de support. `bun src/index.ts skill NOM` et `bun src/index.ts playbook NOM` affichent un document ; seul `run --skill NOM` injecte automatiquement une compétence dans le prompt.

## Prérequis et limites

- `detect` vérifie la présence de l'exécutable, pas sa connexion ni l'accès au modèle. En cas d'erreur, essaie d'abord la CLI directement (`codex`, `claude`, `opencode` ou `pi`).
- Chaque `run` crée un workspace Herdr, **pas** un git worktree. Deux agents utilisant le même `--cwd` modifient les mêmes fichiers : crée des worktrees distincts si tu veux les isoler.
- Si Herdr n'arrive pas à confirmer qu'un premier prompt a été traité, l'outil attend l'activité, vérifie le pane et le transcript avant un éventuel renvoi unique, ou indique `status=unknown`. Utilise `read NOM` avant de continuer.
- Si une CLI reste bloquée **pendant son démarrage**, Pstack CLI affiche son nom, son workspace et son pane, puis conserve sa fiche pour `status` et `read`. Le premier prompt n'a alors **pas** été envoyé : termine la connexion ou la confirmation dans Herdr, puis utilise `resume NOM --prompt "ta tâche initiale"` avec le même `--config` si nécessaire.
- Le modèle enregistré est passé tel quel à la CLI (`--model` pour Claude Code et Pi ; `-m` pour Codex et OpenCode). Le choix du modèle dépend de ton abonnement et de cette CLI.

## Origine et licence

Les rôles, les recommandations de modèles et les budgets proviennent de [`setup-pstack/SKILL.md`](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/setup-pstack/SKILL.md) au commit amont `78f46dacbafc71fd7d937bfc2c26da914f1bc09b`. Les 47 compétences et 23 playbooks sont inclus localement. Voir [LICENSE](LICENSE) pour la licence MIT et l'attribution à Lauren Tan.
