# PDF Leitor

Leitor e editor de PDF **sem propaganda**, para celular e computador.
É um app web instalável (PWA): funciona offline e os arquivos nunca saem do aparelho.

**Usar / instalar:** https://gamepathai.github.io/pdf-leitor/

## O que faz

- **Ler:** rolagem contínua, zoom (botões, Ctrl + roda do mouse, pinça com dois dedos), ir para uma página,
  modo noturno e lembrar a página onde você parou em cada arquivo.
- **Anotar:** grifar, caneta à mão livre, texto (toque de novo num texto para editá-lo), cobrir com branco,
  apagar anotação e desfazer. Dá para escolher a cor e a espessura.
- **Páginas:** girar, mover, apagar e juntar outro PDF no final (no menu ☰).
- **Salvar:** gera `nome-editado.pdf` com todas as edições aplicadas.
- **Abrir:** pelo botão, arrastando o arquivo (no PC), por "Abrir com" (no PC, com o app instalado) ou
  por "Compartilhar → PDF Leitor" (no Android, com o app instalado).

Atalhos: `Ctrl+O` abrir · `Ctrl+S` salvar · `Ctrl+Z` desfazer · `Ctrl +/-/0` zoom · `Esc` volta para "Ler".

## Rodar no computador

```
npm install
npm start
```

Abra http://localhost:8080. No Chrome ou Edge, o ícone de instalar na barra de endereço instala o app.

## Android (app de verdade, abre PDFs por "Abrir com")

Baixe no celular: https://github.com/GamePathAi/pdf-leitor/releases/latest/download/PDF-Leitor.apk

Toque no arquivo baixado e permita "instalar apps desta fonte". Depois, ao tocar num PDF, escolha
**PDF Leitor** e **Sempre**. Novas versões são geradas automaticamente pelo GitHub (`.github/workflows/android.yml`)
a cada mudança em `app/` ou `android/`. Basta baixar e instalar por cima.

O app Android é o mesmo app web empacotado com o Capacitor. A parte nativa fica em
`android/app/src/main/java/com/gamepathai/pdfleitor/PdfBridgePlugin.java` (receber e salvar arquivos).

**Chave de assinatura:** fica em `%LOCALAPPDATA%\PDF Leitor\assinatura-android\` (com a senha no LEIA-ME)
e nos segredos do repositório. Faça backup dessa pasta: sem ela, as próximas versões não instalam por cima.

## Web / iPhone

A pasta `app/` também é publicada no GitHub Pages (https://gamepathai.github.io/pdf-leitor/).
No iPhone, abra no Safari e escolha **"Adicionar à Tela de Início"**. No PC, use o atalho criado por
`desktop/criar-atalho.ps1`.

## Estrutura

- `app/`: o app inteiro (é só isso que se publica)
  - `app.js`: interface, visualização e ferramentas
  - `export.js`: monta o PDF final com as edições
  - `sw.js`: funcionamento offline e recebimento de arquivos compartilhados
  - `vendor/`: pdf.js (exibição) e pdf-lib (edição), copiados por `npm run vendor`
- `scripts/`: copiar bibliotecas, gerar ícones e teste automático (`npm test`)
- `server.js`: servidor local simples

Depois de mudar arquivos do app, aumente `CACHE` em `app/sw.js` (ex.: `v2`) para os aparelhos
instalados receberem a versão nova logo.

## Limites conhecidos

- Não altera o texto original do PDF (escreve por cima; para "trocar" um texto, cubra com branco e escreva).
- PDFs com senha abrem para leitura, mas não dá para salvar edições neles.
- O texto adicionado usa Helvetica; caracteres fora do alfabeto latino viram `?` ao salvar.
