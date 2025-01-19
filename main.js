import puppeteer from 'puppeteer';
import PDFMerger from 'pdf-merger-js';
import fs from 'fs';
import readline from 'readline';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

(async () => {
  // Get base URL and output PDF name from command line arguments
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Please provide the base URL and the output PDF name as arguments.');
    console.log('Example: node main.js https://example.com/dir1/dir2/docs example_docs.pdf');
    process.exit(1);
  }

  const baseURL = args[0];
  const outputPDFName = args[1];
  if (!outputPDFName.endsWith('.pdf')) {
    console.error('Output PDF name must end with .pdf');
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const merger = new PDFMerger();

  try {
    const page = await browser.newPage();
    await page.goto(baseURL, { waitUntil: 'networkidle0' });

    // Get all links to pages within the documentation
    const links = await page.evaluate((baseURL) => {
      const anchors = Array.from(document.querySelectorAll('nav a'));
      return anchors
        .map(a => a.href)
        .filter(href => href.startsWith(baseURL));
    }, baseURL);

    // Remove duplicates and sort for consistency
    const uniqueLinks = [...new Set(links)].sort();

    // Create a temporary directory for individual PDFs
    const tempDir = './temp_pdfs';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Loop through each link, navigate to it, and save as PDF
    for (let i = 0; i < uniqueLinks.length; i++) {
      const link = uniqueLinks[i];
      console.log(`Processing: ${link} (${i + 1}/${uniqueLinks.length})`);

      let currentPage;
      let retries = 0;
      const maxRetries = 3;
      const retryDelay = 30000; // 30 seconds

      while (retries < maxRetries) {
        try {
          currentPage = await browser.newPage();
          await currentPage.goto(link, { waitUntil: 'networkidle0', timeout: 60000 });

          // Inject custom CSS
          await currentPage.addStyleTag({
            content: `
              .cloud-site-container {
                max-width: none;
              }
            `,
          });

          const pdfPath = `${tempDir}/page_${i}.pdf`;
          await currentPage.pdf({ path: pdfPath, format: 'A4' });

          // Add the generated PDF to the merger
          merger.add(pdfPath);
          await sleep(10 * 1000);
          break;

        } catch (error) {
          console.error(`Error processing ${link}, attempt ${retries + 1}/${maxRetries}:`, error);
          retries++;
          if (retries < maxRetries) {
            if (error.name === 'TimeoutError') {
              console.log(`Timeout occurred, retrying in ${retryDelay / 1000} seconds...`);
              await sleep(retryDelay);
            } else {
              console.log(`Non-timeout error occurred, retrying immediately...`);
            }
          } else {
            console.error(`Failed to process ${link} after ${maxRetries} attempts. Continuing with the next link.`);
          }
        } finally {
          if (currentPage) {
            await currentPage.close();
          }
        }
      }
    }

    // Merge all PDFs into a single file
    const mergedPdfPath = `./${outputPDFName}`;
    await merger.save(mergedPdfPath);
    console.log(`Merged PDF saved to: ${mergedPdfPath}`);

    // Ask whether to delete the temporary PDFs
    const answer = await askQuestion('Delete temporary PDF files? (y/n): ');
    if (answer.toLowerCase() === 'y') {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('Temporary PDF files deleted.');
    } else {
      console.log('Temporary PDF files kept.');
    }

  } catch (error) {
    console.error('Error occurred:', error);
  } finally {
    await browser.close();
  }
})();
