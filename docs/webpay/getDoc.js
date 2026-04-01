// docs/webpay/getDoc.js
import axios from 'axios';
import { writeFile } from 'fs/promises';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function downloadTransbankDocs() {
  try {
    console.log('Descargando documentación de Webpay Plus...');
    
    const response = await axios.get('https://www.transbankdevelopers.cl/documentacion/webpay-plus');
    const dom = new JSDOM(response.data);
    
    // Extraer contenido principal
    const mainContent = dom.window.document.querySelector('main, .content, article, #content');
    
    if (!mainContent) {
      throw new Error('No se pudo encontrar el contenido principal');
    }
    
    // Limpiar y formatear el contenido
    const docText = mainContent.textContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
    
    // Guardar en archivo
    const outputPath = join(__dirname, 'transbank-webpay-docs.md');
    await writeFile(outputPath, `# Documentación Webpay Plus - Transbank\n\n${docText}`);
    
    console.log(`✅ Documentación guardada en: ${outputPath}`);
    
    // También extraer enlaces importantes
    const links = Array.from(dom.window.document.querySelectorAll('a[href]'))
      .map(link => ({
        text: link.textContent.trim(),
        url: link.href.startsWith('http') ? link.href : `https://www.transbankdevelopers.cl${link.href}`
      }))
      .filter(link => link.text && link.url.includes('transbank'));
    
    const linksPath = join(__dirname, 'transbank-links.json');
    await writeFile(linksPath, JSON.stringify(links, null, 2));
    console.log(`✅ Enlaces guardados en: ${linksPath}`);
    
  } catch (error) {
    console.error('❌ Error al descargar documentación:', error.message);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadTransbankDocs();
}

export { downloadTransbankDocs };
