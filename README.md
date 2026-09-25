# Pstack CLI

Une adaptation indépendante du [Pstack de Lauren Tan pour Cursor](https://github.com/cursor/plugins/tree/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack). Tu parles à un **agent maître** dans sa CLI (Claude Code, Codex, OpenCode ou Pi). Il suit les vrais workflows Pstack, délègue chaque rôle à une autre CLI reconnue dans la barre latérale **Agents** de [Herdr](#prerequis), collecte les résultats et te répond dans sa propre conversation. Ce ne sont pas des sous-agents natifs de sa CLI. Ce n'est pas une version officielle de Cursor, de Lauren Tan ou de Herdr.

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
2. Détecte Claude Code, Codex, OpenCode et Pi sur le `PATH`. Tu choisis **la CLI et le modèle du maître**, puis **une ou plusieurs CLI workers** avec leurs numéros séparés par des virgules, par exemple `1,2,3`. Pour chaque worker, choisis un rôle distinct ; sa recommandation Lauren Tan est rappelée juste avant de saisir un identifiant de modèle accepté par cette CLI. Les noms de modèles Cursor recommandés en amont ne sont pas automatiquement valables dans les autres CLI.
3. Enregistre ces choix et propose d'ouvrir la conversation principale dans un dossier de projet existant. Dans un terminal interactif, l'assistant t'attache à la CLI maîtresse ; elle reste vivante dans Herdr quand tu détaches le terminal avec `ctrl+b q`. Tu peux refuser et l'ouvrir plus tard avec `bun src/index.ts chat --cwd "C:\ton-projet"`.

Un rôle n'enregistre actuellement **qu'une seule paire CLI/modèle** : sélectionner plusieurs CLI dans l'onboarding leur attribue des rôles différents, pas un groupe interchangeable pour un seul rôle. L'onboarding est relançable pour configurer d'autres rôles. Il ne remplace pas la CLI complète. Pour une configuration isolée, utilise `bun src/onboard.ts --config C:\chemin\vers\config.json` et repasse ce chemin aux commandes avancées.

### Parler au maître et voir ses agents

La conversation maîtresse garde son contexte dans sa propre CLI. Quand tu demandes un travail qui active `how`, `why`, `feature`, `swarm` ou un autre workflow Pstack, le maître lance les rôles configurés par `delegate`, puis lit leurs rapports avec `collect` avant de te répondre. Herdr les reconnaît tous comme agents dans sa barre latérale gauche ; tu peux inspecter leurs terminaux sans quitter la conversation principale.

`chat` affiche un nom `pstack-master-...`, un workspace et un pane Herdr. Pour revenir à cette **même conversation** après avoir détaché le terminal :

```powershell
bun src/index.ts chat pstack-master-...
```

Cette commande vérifie le workspace, le pane, le terminal, le nom et la CLI avant de s'attacher. Elle exige que Herdr et cette CLI soient encore en cours d'exécution ; elle ne ressuscite pas un processus fermé. `run`, `status`, `read` et `resume` restent disponibles pour les workers **autonomes** lancés hors d'une conversation maîtresse.

### Sans assistant

```powershell
bun src/index.ts detect
bun src/index.ts setup
bun src/index.ts setup --master opencode --model "openai/gpt-6-sol"
bun src/index.ts setup --role "bug-fix" --kind codex --model "MODELE_ACCEPTÉ_PAR_CODEX"
bun src/index.ts chat --cwd "C:\chemin\vers\ton-projet"
```

`setup` affiche les recommandations de Lauren Tan, même avec `--config PATH` et même après avoir enregistré des rôles. Il ne vérifie **pas** l'accès au modèle : commence par essayer le modèle dans la CLI choisie. Chaque CLI utilise sa propre connexion ; Pstack CLI ne demande ni ne conserve de clé API.

Pour rendre les commandes plus courtes, `bun link` dans ce dossier enregistre `pstack-init` (l'assistant) et `pstack-cli` (les commandes avancées), à condition que le dossier global des binaires Bun soit sur le `PATH`. Sinon, les commandes `bun src/onboard.ts` et `bun src/index.ts` fonctionnent directement. `bun run build` produit aussi `dist/onboard.js` et `dist/index.js`.

Le [guide détaillé](docs/usage.md) couvre `chat`, `delegate`, `collect`, les commandes autonomes et les scripts. `bun src/index.ts skill NOM` et `bun src/index.ts playbook NOM` affichent leurs instructions ; le maître lit `pstack-master` et `poteto-mode`, puis applique les compétences pertinentes au fil de la conversation.

## Prérequis et limites

- `detect` vérifie la présence de l'exécutable, pas sa connexion ni l'accès au modèle. En cas d'erreur, essaie d'abord la CLI directement (`codex`, `claude`, `opencode` ou `pi`).
- Les délégations d'une conversation sont des agents distincts dans **Agents**, avec leurs propres terminaux Herdr ; ils partagent le workspace du maître. Un `run` autonome crée encore son propre workspace. Ni l'un ni l'autre ne crée de git worktree : donne un worktree distinct à chaque worker qui modifie des fichiers.
- Un worker confirmé écrit son rapport sous `.pstack/tasks/<maître>/<id>.md` dans son dossier de travail. Ignore `.pstack/` dans le dépôt du projet si ce dossier est versionné. Le maître n'utilise ce rapport que lorsque `collect` confirme la fin et l'identité du worker.
- Si Herdr n'arrive pas à confirmer qu'un premier prompt a été traité, l'outil attend l'activité, vérifie le pane et le transcript avant un éventuel renvoi unique, ou indique `status=unknown`. Utilise `read NOM` avant de continuer.
- Si une CLI reste bloquée **pendant son démarrage**, Pstack CLI affiche son nom, son workspace et son pane, puis conserve sa fiche pour `status` et `read`. Le premier prompt n'a alors **pas** été envoyé : termine la connexion ou la confirmation dans Herdr, puis utilise `resume NOM --prompt "ta tâche initiale"` avec le même `--config` si nécessaire.
- Le modèle enregistré est passé tel quel à la CLI (`--model` pour Claude Code et Pi ; `-m` pour Codex et OpenCode). Le choix du modèle dépend de ton abonnement et de cette CLI.

## Origine et licence

Les rôles, les recommandations de modèles et les budgets proviennent de [`setup-pstack/SKILL.md`](https://github.com/cursor/plugins/blob/78f46dacbafc71fd7d937bfc2c26da914f1bc09b/pstack/skills/setup-pstack/SKILL.md) au commit amont `78f46dacbafc71fd7d937bfc2c26da914f1bc09b`. Les 47 compétences et 23 playbooks sont inclus localement. Voir [LICENSE](LICENSE) pour la licence MIT et l'attribution à Lauren Tan.
