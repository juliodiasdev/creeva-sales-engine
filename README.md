# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

# Creava Sales Engine

Aplicativo desktop local-first de prospecção comercial (Tauri 2 + React + SQLite).

## Instalar (usuários)

Baixe o instalador `.exe` mais recente em **Releases** e execute-o. O Windows pode exibir o aviso do SmartScreen: clique em **Mais informações → Executar assim mesmo**.

Cada instalação tem o seu próprio banco local e as suas próprias chaves de API (Settings). Para mover dados entre computadores use **Settings → Exportar/Importar backup**.

## Desenvolvimento

```powershell
npm install
npm run tauri dev   # app desktop
npm test            # testes
npm run build       # checagem de tipos + build web
```

## Publicar uma nova versão

1. Atualize `version` em `package.json` e `src-tauri/tauri.conf.json`.
2. `git tag v0.1.0 && git push origin v0.1.0`
3. O GitHub Actions gera o instalador e o publica em **Releases**.
