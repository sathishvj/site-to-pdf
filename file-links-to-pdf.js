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
  // Get arguments from command line
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Please provide the input file, optional -s flag, and the output PDF name as arguments.');
    console.log('Example: node scrape.js links.txt -s my_document.pdf');
    process.exit(1);
  }

  const inputFile = args[0];
  const scrapeSublinks = args.includes('-s');
  const outputPDFName = args[scrapeSublinks ? 2 : 1];

  if (!outputPDFName.endsWith('.pdf')) {
    console.error('Output PDF name must end with .pdf');
    process.exit(1);
  }

  // Read links from the input file
  let links;
  try {
    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    links = fileContent.split('\n').filter(line => line.trim() !== '');
  } catch (error) {
    console.error('Error reading input file:', error);
    process.exit(1);
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const merger = new PDFMerger();

  try {
    // If -s flag is present, scrape sublinks as well
    if (scrapeSublinks) {
      const allLinks = new Set(links); // Use a Set to avoid duplicates
      for (const link of links) {
        try {
          const page = await browser.newPage();
          await page.goto(link, { waitUntil: 'networkidle0' });

          const subLinks = await page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a'));
            return anchors.map(a => a.href);
          });

          subLinks.forEach(sublink => allLinks.add(sublink));
          await page.close();
        } catch (error) {
          console.error(`Error scraping sublinks from ${link}:`, error);
        }
      }
      links = [...allLinks].sort(); // Convert Set back to sorted array
    }

    // Create a temporary directory for individual PDFs
    const tempDir = './temp_pdfs';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Loop through each link, navigate to it, and save as PDF
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      console.log(`Processing: ${link} (${i + 1}/${links.length})`);

      let currentPage;
      let retries = 0;
      const maxRetries = 3;
      const retryDelay = 30000; // 30 seconds

      while (retries < maxRetries) {
        try {
          currentPage = await browser.newPage();
          await currentPage.goto(link, { waitUntil: 'networkidle0', timeout: 60000 });

          // Inject custom CSS (if needed, adjust the selector)
          await currentPage.addStyleTag({
            content: `
              .cloud-site-container, body { /* You might need more specific selectors here */
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
