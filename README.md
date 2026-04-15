# Three.js WebXR Lab

Projeto minimo para experimentar `three.js` com:

- canvas fullscreen
- cena 3D com piramide, quadrado e cilindro
- navegacao por teclado
- botao de entrada em VR via `WebXR`
- servidor Flask para rede local

## Como rodar

Nao abra `index.html` direto no Windows.
Este projeto precisa ser servido por HTTP.

Opcao 1:

```bash
npm run dev -- --host 0.0.0.0
```

Ou no Windows:

```bash
run-npm-dev.bat
```

Opcao 2:

```bash
python serve_lab.py
```

Ou no Windows:

```bash
run-flask-serve.bat
```

O script Python gera o build e sobe um servidor Flask em `0.0.0.0:8000`.

## GitHub Pages

O projeto ja esta preparado para publicar no GitHub Pages usando o nome do repositorio:

```text
threejs-webxr-lab
```

Quando voce subir para o GitHub e fizer push para a branch `master`, o workflow em [deploy-pages.yml](C:\Users\Christoph Cury\source\2026\threejs-webxr-lab\.github\workflows\deploy-pages.yml) vai gerar o `dist/` e publicar no Pages.

URL esperada:

```text
https://SEU-USUARIO.github.io/threejs-webxr-lab/
```

## Acesso em outro dispositivo

Com o servidor rodando, abra no outro dispositivo o endereco mostrado como rede local, por exemplo:

```text
http://192.168.0.25:8000
```

## Controles

- `Setas` ou `W A S D`: mover
- `Shift + setas`: girar / inclinar a camera
- `Q / E`: subir / descer

## Observacoes

- O botao de VR depende de suporte a `WebXR` no navegador/dispositivo.
- `WebXR` exige contexto seguro. Em geral, para teste fora de `localhost`, pode ser necessario usar `HTTPS`.
