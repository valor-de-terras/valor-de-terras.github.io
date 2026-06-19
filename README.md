# Valor de Terras

> Plataforma de avaliação de terras e propriedades com dados abertos e NBR 14.653.
> Da geometria do imóvel ao valor estimado, em minutos.

Site institucional + demonstração interativa do produto, publicado em **GitHub Pages**:
**https://valor-de-terras.github.io**

Este repositório contém o **front-end estático** (vitrine + demo). O pipeline de back-end
(FastAPI + PostGIS + worker de enriquecimento + geração de laudo) é descrito na seção
"Arquitetura" do site e vive em repositório próprio.

## O que a demo faz

A demonstração roda inteiramente no navegador, simulando o fluxo real do produto:

1. **Informe o imóvel** de três formas:
   - upload de arquivo geográfico (`.kml`, `.kmz`, `.shp` em `.zip`, `.geojson`);
   - clique em um ponto no mapa (o sistema sintetiza o CAR sobreposto);
   - selecione um imóvel de exemplo no Paraná.
2. **Enriquecimento** com camadas de dados abertos (relevo, solo, uso, clima, hidrografia,
   acesso, embargos, comparáveis), animado passo a passo.
3. **Estimativa preliminar** (mínimo / médio / máximo) com homogeneização NBR 14.653 e
   tabela de comparáveis.
4. **Prévia do laudo** no formato NBR 14.653 (modal, pronta para impressão/PDF).

> Os dados da demo são **sintéticos e ilustrativos**. Não constituem laudo nem parecer
> técnico. O laudo formal exige responsabilidade técnica (ART) de profissional habilitado
> junto ao CREA.

## Stack do front-end

- **React 18 + TypeScript + Vite**
- **MapLibre GL JS** (mapas sem vendor lock; basemaps CARTO e Esri World Imagery)
- **CSS Modules** com design system próprio (tokens em `src/styles/tokens.css`)
- Parsing geográfico client-side: `@tmcw/togeojson`, `shpjs`, `jszip`

## Desenvolvimento

```bash
npm install
npm run dev        # servidor de desenvolvimento (Vite)
npm run build      # build de produção em dist/
npm run preview    # serve o build localmente
```

## Deploy

Publicação automática no GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`)
a cada push na branch `main`. O Pages é servido na raiz da organização porque o repositório
se chama `valor-de-terras.github.io`.

## Estrutura

```
src/
  components/
    layout/      Nav, Footer
    sections/    seções da landing (Hero, Problema, Como funciona, Preços, FAQ, ...)
    demo/        demo interativa (MapView, MapDemo, EnrichmentTimeline, EstimateCard, ReportPreview)
  data/          dados mockados da demo (imóveis exemplo, camadas, engine de estimativa)
  lib/           utilidades (geometria, parsing geográfico, formatação, hook de reveal)
  styles/        tokens e base do design system
```

## Licença

Conteúdo e código deste site sob a organização [valor-de-terras](https://github.com/valor-de-terras).
