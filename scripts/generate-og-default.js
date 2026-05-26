import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'fs';

const WIDTH = 1200;
const HEIGHT = 630;

async function loadFont(url) {
  const res = await fetch(url);
  return await res.arrayBuffer();
}

async function main() {
  const jetBrainsMono = await loadFont(
    'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@2.304/fonts/ttf/JetBrainsMono-Bold.ttf'
  );
  const archivoBlack = await loadFont(
    'https://github.com/google/fonts/raw/main/ofl/archivoblack/ArchivoBlack-Regular.ttf'
  );

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: WIDTH,
          height: HEIGHT,
          background: '#0a0a0b',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 64px',
          position: 'relative',
          overflow: 'hidden',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'flex-start',
                alignItems: 'center',
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#f5f5f4',
                      letterSpacing: '-0.02em',
                    },
                    children: 'TRUMPY',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#c94a3e',
                      letterSpacing: '-0.02em',
                    },
                    children: '/',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 42,
                      color: '#f5f5f4',
                      letterSpacing: '-0.02em',
                    },
                    children: 'TRACKER',
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'Archivo Black',
                      fontSize: 28,
                      color: '#a3a3a3',
                      letterSpacing: '0.02em',
                    },
                    children: 'A daily accountability log.',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      fontFamily: 'JetBrains Mono',
                      fontSize: 16,
                      color: '#737373',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                    },
                    children: 'Sourced · Cited · Updated',
                  },
                },
              ],
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontFamily: 'JetBrains Mono',
                fontSize: 14,
                color: '#525252',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              },
              children: 'trumpytracker.com',
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'JetBrains Mono', data: jetBrainsMono, weight: 700, style: 'normal' },
        { name: 'Archivo Black', data: archivoBlack, weight: 400, style: 'normal' },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });
  const png = resvg.render().asPng();
  writeFileSync('public/og-default.png', png);
  console.log(`Generated public/og-default.png (${png.length} bytes)`);
}

main().catch(console.error);
