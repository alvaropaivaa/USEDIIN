# Prompts de imagem: carrossel "pra onde foi" (Dinn)

O Claude não gera imagem. Cole no ChatGPT (ou no Codex) e **anexe as referências indicadas**. Gere **uma imagem primeiro** (a âncora), aprove, e só depois peça as outras com a âncora anexada.

Salvar em `carrosseis/assets/3d/mascote/NN-nome.png` e registrar no `manifest.json` da pasta.

> O estilo do Dinn é 3D **brilhante** (vinil), não o 3D fosco padrão da skill. Por isso o bloco de estilo abaixo troca "fosco" por "vinil brilhante" e mantém a proibição de neon e sparkles.

## Bloco de estilo (igual em todos)

```
Estilo: personagem 3D de animação, acabamento de vinil brilhante com reflexos suaves, luz de estúdio suave do alto à esquerda, sombra de contato leve.
Personagem: o mascote do Dinn. Corpo em forma de gota que termina numa seta apontando para cima no topo da cabeça. Verde-esmeralda #15803D, sombras #0F3B2C, reflexos #4ADE80. Uma faixa creme #F3EAD2 contorna a seta e o rosto. O rosto é um visor oval preto e liso com os olhos e o sorriso desenhados em linha creme luminosa (sem nariz, sem boca de verdade, sem traços humanos). Luvas brancas de desenho animado com punhos creme, tênis verdes com sola e faixas brancas.
Siga exatamente o personagem, as cores e a luz das imagens de referência anexadas.
Fundo transparente de verdade, recorte limpo, sem contorno nem brilho verde em volta da silhueta. PNG, 2048x2048.
Não incluir: texto, letras, números, logos, cenário, neon, sparkles, brilho de estrela, cromado.
```

---

## 1. Capa v2: "pra onde foi o dinheiro?" (ÂNCORA, gerar primeiro)

**Anexar:** `assets/3d/mascote/08-acenando-borda.png` (estilo em alta) e `assets/3d/mascote/10-carteira-duvida.png` (pose de referência).

```
Crie uma imagem 3D do mascote do Dinn segurando com as duas mãos uma carteira verde aberta e vazia, olhando para dentro dela com cara de surpresa (um olho redondo arregalado, o outro levemente fechado). Duas moedas douradas escapam da carteira e voam para cima e para fora, e um ponto de interrogação 3D verde-claro flutua ao lado da cabeça.
Uso: capa do carrossel "O salário caiu dia 5. No dia 20, já tinha sumido." Vai no terço de baixo de um slide verde-escuro, grande, com o título em cima.
Composição: corpo inteiro, ângulo 3/4, ocupando ~75% do quadro, com espaço livre acima da cabeça.
[cole aqui o bloco de estilo]
```

**Codex (curto):** `Mascote do Dinn segurando a carteira verde aberta e vazia, surpreso, com duas moedas voando para fora e um "?" 3D ao lado. Corpo inteiro, transparente, 2048px, sem halo verde. Salve em carrosseis/assets/3d/mascote/20-carteira-vazia.png e me mostre.`

---

## 2. Slide 2: "o gasto pequeno que escapa"

**Anexar:** a âncora aprovada do prompt 1 e `assets/3d/mascote/11-anotando.png`.

```
Crie uma imagem 3D do mascote do Dinn sentado no chão anotando num caderninho espiral com um lápis, concentrado, enquanto um cupom fiscal comprido se desenrola do colo dele até o chão, fazendo curvas. Três moedas pequenas rolam para longe pelo chão, sem ele perceber.
Uso: slide "Não é falta de esforço. É falta de enxergar." Entra encostado no canto inferior direito, ao lado dos valores.
Composição: corpo inteiro, ângulo 3/4, ocupando ~70% do quadro.
[cole aqui o bloco de estilo]
```

**Codex (curto):** `Mascote do Dinn sentado anotando num caderninho, com um cupom fiscal comprido desenrolando até o chão e moedinhas rolando para longe sem ele ver. Mesmo estilo da âncora, transparente, 2048px. Salve em carrosseis/assets/3d/mascote/21-anotando-cupom.png.`

---

## 3. CTA alternativo: mascote mostrando o celular

A tela vem **lisa**: o print real do app é encaixado por cima no HTML (a skill não deixa inventar interface).

**Anexar:** a âncora aprovada do prompt 1.

```
Crie uma imagem 3D do mascote do Dinn de corpo inteiro, de frente, segurando um celular grande com a tela virada para a câmera e fazendo joinha com a outra mão, sorrindo (um olho piscando).
A tela do celular é um retângulo liso verde muito claro #E3EFE7, sem nenhum desenho, ícone ou texto, sem reflexo forte, vista bem de frente (sem perspectiva) para encaixar um print depois.
Uso: último slide, "Agora você sabe pra onde o dinheiro vai."
Composição: corpo inteiro, ocupando ~75% do quadro, celular na altura do peito.
[cole aqui o bloco de estilo]
```

**Codex (curto):** `Mascote do Dinn de frente, segurando um celular com a tela lisa verde-clara #E3EFE7 virada para a câmera (sem nada desenhado, bem de frente) e fazendo joinha. Transparente, 2048px. Salve em carrosseis/assets/3d/mascote/22-mostrando-celular.png.`

---

## 4. Série atual em alta (para os próximos carrosséis)

As poses do app (`02-avisos`, `03-categorias`, `04-conversa`, `05-metas`) e as do quiz (`10` a `15`) têm só 320 a 500px e ficam borradas num slide. Para cada uma, anexe a imagem e peça:

```
Recrie esta mesma imagem em 2048x2048: mesma pose, mesmos objetos, mesmas cores e mesma luz. Só aumente a resolução e os detalhes.
Fundo transparente de verdade, recorte limpo, sem contorno nem brilho verde em volta da silhueta. Não incluir texto, logos, neon nem sparkles.
```

Salve com o mesmo número e o sufixo `-2048` (ex.: `05-metas-2048.png`).

---

## Checagem antes de aprovar (da skill)
- Fundo transparente de verdade (sem quadriculado "pintado") e sem halo verde.
- Visor preto liso, olhos de linha creme, seta no topo da cabeça: igual ao mascote do app.
- Sem texto, letra ou logo inventado.
- Mesma luz e ângulo da âncora; legível pequeno.
