# WebXR Hand Tracking — Catalogo de Recursos e Exemplos

Referencia para avaliar o que existe e o que podemos usar no projeto.


## 1. Modelos de Mao

Three.js oferece 2 sistemas prontos para representar maos em VR:

### XRHandModelFactory (generico, funciona em qualquer headset)

Classe: `three/examples/jsm/webxr/XRHandModelFactory.js`

Aceita um parametro `profile` com 3 opcoes:

| Profile     | Classe interna         | Visual                                     |
|-------------|------------------------|---------------------------------------------|
| `"spheres"` | `XRHandPrimitiveModel` | Esferas nas 25 juntas dos dedos (padrao)    |
| `"boxes"`   | `XRHandPrimitiveModel` | Cubos nas 25 juntas                         |
| `"mesh"`    | `XRHandMeshModel`      | Malha poligonal realista (carrega glTF)     |

Uso:
```js
const factory = new XRHandModelFactory();
const hand = renderer.xr.getHand(0);
hand.add(factory.createHandModel(hand, "spheres")); // ou "boxes" ou "mesh"
scene.add(hand);
```

Para `"mesh"`, precisa de um GLTFLoader e dos modelos .glb que ficam no repo
do three.js (`examples/models/xr/hands/`). Se nao settar `factory.setPath()`,
usa path padrao.

Exemplo que demonstra os 3 perfis: **handinput_profiles** (ver abaixo).

### OculusHandModel (especifico Meta/Oculus)

Classe: `three/examples/jsm/webxr/OculusHandModel.js`

Estende `Object3D`. Usa `XRHandMeshModel` internamente mas adiciona:
- `intersectBoxObject(object)` — deteccao de colisao direta dedo-vs-caixa
- `getPointerPosition()` — posicao do `index-finger-tip`
- `checkButton(object)` — testa se o dedo esta tocando um botao

Usado nos exemplos pressbutton, pointerclick e pointerdrag.


## 2. Tecnicas de Interacao

### 2.1 Ray Cast (Raio da mao)

Raio sai da mao e detecta intersecao com objetos via raycaster.
Pinch (polegar+indicador) confirma selecao.

- **Nosso projeto**: raio do centro da palma (wrist→middle-metacarpal)
- **pointerclick / pointerdrag**: `OculusHandPointerModel` com `isPinched()`
- **handinput_profiles**: raio simples via `BufferGeometry` line

Vantagem: funciona a distancia. Natural para menus na parede.
Desvantagem: precisao depende de estabilidade do raio.

### 2.2 Direct Touch (Toque direto)

Dedo toca fisicamente o objeto 3D. Deteccao por proximidade ou colisao.

- **pressbutton**: `intersectBoxObject()` + calculo de `pressingDistance`
- **immersive-hands**: distancia euclidiana entre `index-finger-tip` e centroide
- **Nosso projeto**: nao implementado ainda

Vantagem: intuitivo, sem aprender gestos.
Desvantagem: precisa estar perto do objeto.

### 2.3 Pinch Grab (Pegar com pinca)

Pincar com polegar+indicador num objeto para "agarra-lo" e mover.

- **pointerdrag**: `isPinched()` ativa estado "attached", cubo segue a mao
- **input-selection**: `squeezestart/squeezeend` para grab (via controller)

Vantagem: manipulacao direta de objetos.
Desvantagem: precisa logica de attach/detach.

### 2.4 Two-Hand Manipulation (Duas maos)

Duas maos pincando controlam o cenario (zoom, rotacao, translacao).

- **Nosso projeto (v7)**: linha amarela entre pinch points, worldRoot transform
- **Nenhum dos exemplos acima implementa isso** — eh um pattern mais avancado

Vantagem: controle natural do espaco.
Desvantagem: complexidade do gesto, conflito com selecao.

### 2.5 Botao com Feedback Fisico

Botao que afunda quando pressionado com o dedo.

- **pressbutton**: `pressingDistance` controla `position.y` do botao, com
  estados (resting → pressed → fully_pressed → recovering), som de clique

Vantagem: feedback tatil visual muito bom.
Desvantagem: requer direct touch (precisa estar perto).


## 3. Elementos de UI em VR

### 3.1 Parede de Botoes (Wall Panel)

Botoes fixos no espaco, ativados por ray cast ou toque direto.

- **Nosso projeto**: 4 botoes PlaneGeometry na parede com CanvasTexture
- **pointerclick**: 4 botoes com escala 1.1x no hover

### 3.2 Painel Movel (Held Panel / Tablet)

Painel que acompanha a mao, como um tablet virtual.

- **Nosso projeto (v4+)**: panelRoot segue wristWorld da mao esquerda,
  20 botoes toggle + Finalizar, modo persistente via botao na parede

### 3.3 Console / Painel de Controle

Objeto 3D no espaco com botoes fisicos.

- **pressbutton**: `consoleMesh` (BoxGeometry) com 4 botoes que afundam

### 3.4 Menu Flutuante

Menu translucido posicionado no espaco.

- **pointerdrag**: painel com 2 botoes e cubos arrastaveis


## 4. Feedback Visual

| Tecnica             | Exemplo           | Como funciona                                    |
|---------------------|-------------------|--------------------------------------------------|
| Escala no hover     | pointerclick      | `object.scale.set(1.1, 1.1, 1.1)` ao apontar    |
| Afundar botao       | pressbutton       | `position.y -= pressingDistance`                  |
| Mudanca de cor      | pointerclick      | `material.color.setHex()` ao clicar              |
| Toggle on/off       | nosso projeto     | Fundo verde/azul escuro nos botoes do painel      |
| Som                 | pressbutton       | `THREE.Audio` com press/release .ogg              |
| Cursor de raio      | pointerdrag       | `setCursor(distance)` ajusta comprimento do raio  |
| Rotacao continua    | pressbutton       | `rotation.x += delta` em objetos decorativos      |


## 5. APIs WebXR Nativas vs Three.js

### APIs nativas usadas nos exemplos

| API                    | Funcao                                        | Usado em              |
|------------------------|-----------------------------------------------|-----------------------|
| `XRHand`               | Interface de hand tracking                    | immersive-hands       |
| `XRJointSpace`         | Espaco de cada junta do dedo                  | immersive-hands       |
| `frame.fillPoses()`    | Preenche array de poses de todas as juntas    | immersive-hands       |
| `frame.fillJointRadii` | Raios das juntas (para escala visual)         | immersive-hands       |
| `XRInputSource`        | Fonte de entrada (mao ou controller)          | todos                 |
| `selectstart/end`      | Eventos de selecao                            | input-selection       |
| `squeezestart/end`     | Eventos de grip/preensao                      | input-selection       |
| `gamepad.buttons`      | Estado de botoes do controller                | controller-state      |
| `gamepad.axes`         | Eixos analogicos do controller                | controller-state      |

### Abstracoees Three.js que usamos

| Classe                    | O que faz                                      |
|---------------------------|------------------------------------------------|
| `XRHandModelFactory`      | Cria modelo visual da mao (spheres/boxes/mesh) |
| `renderer.xr.getHand(i)`  | Retorna Group com joints da mao i              |
| `hand.joints["nome"]`     | Acessa XRJointSpace de cada junta              |
| `joint.getWorldPosition`  | Posicao global da junta                        |
| `VRButton.createButton`   | Botao HTML para entrar em VR                   |


## 6. Fichas dos Exemplos

### pressbutton
- **Repo**: [mrdoob/three.js](https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_pressbutton.html)
- **Foco**: Direct touch — dedo fisicamente pressiona botoes que afundam
- **Mao**: `OculusHandModel` (mesh realista)
- **Destaques**: estados de botao (resting/pressed/fully/recovering), sons, ECS (ECSY)
- **Usar para**: referencia de botoes fisicos com feedback de profundidade

### pointerdrag
- **Repo**: [mrdoob/three.js](https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_pointerdrag.html)
- **Foco**: Ray cast + pinch drag — pinca no cubo, arrasta no espaco
- **Mao**: `OculusHandModel` + `OculusHandPointerModel`
- **Destaques**: 20 cubos arrastaveis, menu flutuante, `isPinched()` para grab
- **Usar para**: referencia de drag & drop em VR

### pointerclick
- **Repo**: [mrdoob/three.js](https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_pointerclick.html)
- **Foco**: Ray cast + pinch click — aponta e pinca para trocar cor
- **Mao**: `OculusHandModel` + `OculusHandPointerModel`
- **Destaques**: escala 1.1x no hover, 4 botoes, TorusKnot central
- **Usar para**: referencia de click/selection por ray

### handinput_profiles
- **Repo**: [mrdoob/three.js](https://github.com/mrdoob/three.js/blob/master/examples/webxr_vr_handinput_profiles.html)
- **Foco**: Demonstracao dos 3 perfis de mao (spheres, boxes, mesh)
- **Mao**: `XRHandModelFactory` com os 3 profiles lado a lado
- **Destaques**: pinch alterna entre perfis, OrbitControls para desktop
- **Usar para**: escolher visual de mao; testar qual perfil fica melhor

### input-selection (WebXR Samples)
- **Repo**: [immersive-web/webxr-samples](https://github.com/immersive-web/webxr-samples/blob/main/input-selection.html)
- **Foco**: Event model nativo do WebXR (select/squeeze)
- **Mao**: N/A (foco em controllers)
- **Destaques**: `selectstart/select/selectend`, `squeezestart/squeeze/squeezeend`, handedness
- **Usar para**: entender o ciclo de eventos WebXR sem abstracoes

### controller-state (WebXR Samples)
- **Repo**: [immersive-web/webxr-samples](https://github.com/immersive-web/webxr-samples/blob/main/controller-state.html)
- **Foco**: Visualizacao em tempo real do estado de botoes/axes do gamepad
- **Mao**: N/A (controllers)
- **Destaques**: `gamepad.buttons[i].pressed/value/touched`, `gamepad.axes`, cubos que mudam cor/escala
- **Usar para**: debug de controllers; entender mapping de botoes

### immersive-hands (WebXR Samples)
- **Repo**: [immersive-web/webxr-samples](https://github.com/immersive-web/webxr-samples/blob/main/immersive-hands.html)
- **Foco**: Hand tracking nativo sem abstracoees Three.js
- **Mao**: Cubos por junta (implementacao manual, sem XRHandModelFactory)
- **Destaques**: `frame.fillPoses()`, `frame.fillJointRadii()`, 25 joints, interacao por proximidade
- **Usar para**: entender a API WebXR Hand Tracking pura (sem three.js helpers)


## 7. O que Podemos Explorar a Seguir

Funcionalidades vistas nos exemplos que ainda nao temos:

1. **Direct touch (botao que afunda)** — combinar com o painel movel
2. **Grab & drag de objetos** — pincar uma forma e arrastar no espaco
3. **Profile "mesh"** — mao realista em vez de esferas
4. **Som em botoes** — feedback sonoro no pinch/click
5. **Squeeze / grip events** — segundo gesto alem do pinch
6. **Cursor visual no raio** — ponto brilhante onde o raio bate
