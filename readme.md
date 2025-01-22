Download a website as a pdf.

To run: 
* clone this repo
* npm install
* node main.s https://example.com/dir1/docs example_docs.pdf


## link to pdf
node link-to-pdf.js <link> output.pdf

This will start at link and download the whole sub-site.

## file-links-to-pdf
node file-links-to-pdf.js links.txt output.pdf

node file-links-to-pdf.js -s links.txt output.pdf

This collects each line in links.txt and downloads it as a pdf.

-s option will also follow the links to its sublinks.
