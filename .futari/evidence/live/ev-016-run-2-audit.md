# EV-016 run 2 owner audit sheet

Run log: .futari/evidence/live/ev-016-run-2-20261121T082449Z.json (git cf0c1f2c324acd5ecc27c7c668832f53cfa7062b).
Displayed image bytes (not committed): /Users/josiahwong/.claude/jobs/ab921430/tmp/ev016-run2-images. Full-page screenshots (not committed): /Users/josiahwong/.claude/jobs/ab921430/tmp/ev016-run2-shots.

Offer rubric (evals/cases/live-acceptance-v1-1.json auditRubric):
- Right product: the merchant page sells the candidate model (a colour variant counts; a different model or a bundle does not).
- Direct merchant: the URL is the merchant's own product page, not a review, aggregator, marketplace, search, or category page.
- Price display: the shown price, currency, and availability equal the values Exa returned for that URL in this run, as recorded in the run log.

Threshold: at least 90% of all displayed offers pass all three checks (main list and Other markets). Only the owner fills Right product and Direct merchant. Price display is prefilled by revalidation: the page's row equals the offer in the log, and the offer equals the summary Exa returned for that URL in this run.

## Displayed offers

| ID | Query | Card product | Merchant host | Price | Availability | URL | Page title (Exa) | Placement | Right product | Direct merchant | Price display |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-O1 | Q1 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | instacart.com | 169.99 USD | in_stock | https://www.instacart.com/store/products/27435482-sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black-each | Sony WH-1000XM5 Wireless Noise-Canceling Over-the-Ear Headphones - Black | main list |  |  | pass (equal) |
| Q1-O2 | Q1 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | electronics.sony.com | 198 USD | in_stock | https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-l | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | main list |  |  | pass (equal) |
| Q1-O3 | Q1 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | amazon.com | 199.95 USD | in_stock | https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones-Hands-Free/dp/B09XS7JWHH | Sony WH-1000XM5 Premium Noise Cancelling Wireless Headphones, Black | main list |  |  | pass (equal) |
| Q1-O4 | Q1 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | walmart.com | 288 USD | in_stock | https://www.walmart.com/ip/Sony-WH-1000XM5-The-Best-Wireless-Noise-Canceling-Headphones-Black/386006068 | Sony WH-1000XM5 The Best Wireless Noise Canceling Headphones, Black | main list |  |  | pass (equal) |
| Q1-O5 | Q1 | Sony WH-1000XM6 Wireless Noise Cancelling Headphones | electronics.sony.com | 348 USD | in_stock | https://electronics.sony.com/audio/headphones/headband/p/wh1000xm6-b | WH-1000XM6 Best Wireless Noise Cancelling Headphones \| Black | main list |  |  | pass (equal) |
| Q1-O6 | Q1 | Sony WH-1000XM6 Wireless Noise Cancelling Headphones | amazon.com | 378 USD | in_stock | https://www.amazon.com/Sony-WH-1000XM6-Headphones-Microphones-Studio-Quality/dp/B0F3PQHWTZ | Sony WH-1000XM6 The Best Noise Cancelling Wireless Headphones, Black | main list |  |  | pass (equal) |
| Q1-O7 | Q1 | Sony WH-1000XM6 Wireless Noise Cancelling Headphones | bestbuy.com | 458 USD | in_stock | https://www.bestbuy.com/product/sony-wh-1000xm6-best-wireless-noise-canceling-headphones-silver/J7XSRH5R2X/sku/10202332 | Sony - WH-1000XM6- Best Wireless Noise Cancelling Headphones - Silver | main list |  |  | pass (equal) |
| Q1-O8 | Q1 | Sony WH-1000XM6 Wireless Noise Cancelling Headphones | microcenter.com | 459.99 USD | in_stock | https://www.microcenter.com/product/696486/sony-wh-1000xm6-wireless-active-noise-cancelling-headphones-platinum-silver | Sony WH-1000XM6 Wireless Active Noise Cancelling Headphones - Platinum Silver | main list |  |  | pass (equal) |
| Q2-O1 | Q2 | Logitech MX Master 4 | logitech.com | 89.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-master-4-mac-refurbished | Refurbished MX Master 4 for Mac Wireless Mouse \| Logitech | main list |  |  | pass (equal) |
| Q2-O2 | Q2 | Logitech MX Master 4 | logitech.com | 89.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-master-4-refurbished | Refurbished MX Master 4 Wireless Mouse \| Logitech | main list |  |  | pass (equal) |
| Q2-O3 | Q2 | Logitech MX Master 4 | logitech.com | 109.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-master-4 | MX Master 4 Wireless Mouse | main list |  |  | pass (equal) |
| Q2-O4 | Q2 | Logitech MX Master 4 | amazon.com | 118 USD | in_stock | https://www.amazon.com/Logitech-Ergonomic-Bluetooth-Performance-Ultra-Fast/dp/B0FC5C7VCJ | Logitech MX Master 4 for Mac, Ergonomic Bluetooth Mouse with Advanced Performance Haptic Feedback, Ultra-Fast Scrolling, USB-C Charging, MacOS, iPadOS, Windows - White Silver | main list |  |  | pass (equal) |
| Q3-O1 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation%2C-headphones-midnight-blue-wh-1000xm5%2Flme-IP183532.html | SONY Wireless Noise Cancelling, Headphones (midnight Blue) WH-1000XM5/LME | main list |  |  | FAIL: Exa currency S$ vs shown SGD |
| Q3-O2 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation-headphones-black-wh-1000xm5%2Fbme-IP176694.html | SONY Wireless Noise Cancellation Headphones (black) WH-1000XM5/BME | main list |  |  | pass (equal) |
| Q3-O3 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | harveynorman.com.sg | 298 SGD | in_stock | https://www.harveynorman.com.sg/tv-and-audio/headphones-en/over-ear-headphones-en-2/sony-wh-1000xm5-lme-wireless-noise-cancelling-headphones-midnight-blue.html | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | main list |  |  | pass (equal) |
| Q3-O4 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | online.challenger.sg | 309 SGD | in_stock | https://online.challenger.sg/products/sony-wh-1000xm5-wireless-noise-cancelling-headphones-blue | Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Blue) | main list |  |  | pass (equal) |
| Q3-O5 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | amazon.sg | 310 SGD | in_stock | https://www.amazon.sg/dp/B09ZFD9CBB?language=en_SG&th=1 | Sony WH-1000XM5 Noise Cancelling Wireless Over-Ear Headphones, Bluetooth, Clear Call Quality, Hi-Res, Up to 30hr Battery Life, Quick Charge, Alexa & Google Assistant, iOS & Android - Black : Amazon.sg: Electronics | main list |  |  | FAIL: Exa currency S$ vs shown SGD |
| Q3-O6 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | metapod.com | 313 SGD | in_stock | https://metapod.com/products/sony-wh-1000xm5-wireless-noise-cancelling-headphones | Sony WH-1000XM5 Noise Cancelling Wireless Headphones (XM5) | main list |  |  | pass (equal) |
| Q3-O7 | Q3 | Sony WH-1000XM5 Midnight Blue Edition | bestdenki.com.sg | 329 USD | in_stock | https://www.bestdenki.com.sg/0606729-sony-earphones-headphones-earbuds-wh-1000xm5-lme.html | SONY EARPHONES/HEADPHONES/EARBUDS WH-1000XM5/LME | Other markets |  |  | pass (equal) |
| Q4-O1 | Q4 | Breville the Bambino Plus | harveynorman.com.sg | 698 SGD | in_stock | https://www.harveynorman.com.sg/home-appliances/small-kitchen-appliances-en/coffee-machines-en/breville-the-bambino-plus-stainless-steel-bes500bss.html | Breville The BambinoÂ® Plus - Stainless Steel (BES500BSS) | main list |  |  | pass (equal) |
| Q5-O1 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | shopping.yahoo.co.jp | 38280 JPY | in_stock | https://shopping.yahoo.co.jp/products/3287be2814 | SONY ãƒ¯ã‚¤ãƒ¤ãƒ¬ã‚¹ãƒŽã‚¤ã‚ºã‚­ãƒ£ãƒ³ã‚»ãƒªãƒ³ã‚°ã‚¹ãƒ†ãƒ¬ã‚ªãƒ˜ãƒƒãƒ‰ã‚»ãƒƒãƒˆ WH-1000XM5ï¼ˆBï¼‰ ãƒ–ãƒ©ãƒƒã‚¯ ãƒ˜ãƒƒãƒ‰ãƒ›ãƒ³æœ¬ä½“ | main list |  |  | pass (equal) |
| Q5-O2 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | yodobashi.com | 45440 JPY | in_stock | https://www.yodobashi.com/product/100000001007090035/ | ã‚½ãƒ‹ãƒ¼ SONY ãƒ¯ã‚¤ãƒ¤ãƒ¬ã‚¹ãƒŽã‚¤ã‚ºã‚­ãƒ£ãƒ³ã‚»ãƒªãƒ³ã‚°ã‚¹ãƒ†ãƒ¬ã‚ªãƒ˜ãƒƒãƒ‰ã‚»ãƒƒãƒˆ ãƒ–ãƒ©ãƒƒã‚¯ WH-1000XM5 B | main list |  |  | pass (equal) |
| Q5-O3 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | edion.com | 51000 JPY | in_stock | https://www.edion.com/detail.html?p_cd=00071159386 | SONY WH-1000XM5 B ãƒ¯ã‚¤ãƒ¤ãƒ¬ã‚¹ãƒŽã‚¤ã‚ºã‚­ãƒ£ãƒ³ã‚»ãƒªãƒ³ã‚°ã‚¹ãƒ†ãƒ¬ã‚ªãƒ˜ãƒƒãƒ‰ã‚»ãƒƒãƒˆ ãƒ–ãƒ©ãƒƒã‚¯ | main list |  |  | pass (equal) |
| Q5-O4 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | store.shopping.yahoo.co.jp | 54780 JPY | in_stock | https://store.shopping.yahoo.co.jp/yamada-denki/1591424015.html | ã‚½ãƒ‹ãƒ¼ ãƒ¯ã‚¤ãƒ¤ãƒ¬ã‚¹ ãƒ˜ãƒƒãƒ‰ãƒ›ãƒ³ ãƒã‚¤ãƒ¬ã‚¾ ãƒŽã‚¤ã‚ºã‚­ãƒ£ãƒ³ã‚»ãƒªãƒ³ã‚° æœ€å¤§40æ™‚é–“ USB-C WH-1000XM5 BM ãƒ–ãƒ©ãƒƒã‚¯ç³» | main list |  |  | pass (equal) |
| Q5-O5 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | sony.jp | 56100 JPY | in_stock | https://www.sony.jp/headphone/products/WH-1000XM5/ | WH-1000XM5 | main list |  |  | pass (equal) |
| Q7-O1 | Q7 | Bose QuietComfort Headphones (2nd Gen) | bose.sg | 429 SGD | in_stock | https://bose.sg/products/quietcomfort-headphones-2nd-gen | QuietComfort Headphones (2nd Gen) | main list |  |  | pass (equal) |
| Q7-O2 | Q7 | Bose QuietComfort Headphones (2nd Gen) | tkfoto.com.sg | 429 USD | in_stock | https://tkfoto.com.sg/products/bose-quietcomfort-headphones-2nd-gen | Bose QuietComfort Headphones (2nd Gen) | Other markets |  |  | pass (equal) |
| Q7-O3 | Q7 | Bose QuietComfort Headphones | metapod.com | 239 SGD | in_stock | https://metapod.com/products/bose-quietcomfort-headphones | Bose QuietComfort Headphones | main list |  |  | pass (equal) |
| Q7-O4 | Q7 | Bose QuietComfort Headphones | techhouse.sg | 399 USD | in_stock | https://techhouse.sg/products/bose-quietcomfort-headphones | Bose QuietComfort Headphones | Other markets |  |  | pass (equal) |
| Q8-O1 | Q8 | Sony WH-1000XM5 | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation%2C-headphones-midnight-blue-wh-1000xm5%2Flme-IP183532.html | SONY Wireless Noise Cancellation, Headphones (midnight Blue) WH-1000XM5/LME | main list |  |  | pass (equal) |
| Q8-O2 | Q8 | Sony WH-1000XM5 | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation-headphones-black-wh-1000xm5%2Fbme-IP176694.html | SONY Wireless Noise Cancellation Headphones (black) WH-1000XM5/BME | main list |  |  | pass (equal) |
| Q8-O3 | Q8 | Sony WH-1000XM5 | harveynorman.com.sg | 298 SGD | in_stock | https://www.harveynorman.com.sg/tv-and-audio/headphones-en/over-ear-headphones-en-2/sony-wh-1000xm5-lme-wireless-noise-cancelling-headphones-midnight-blue.html | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | main list |  |  | pass (equal) |
| Q8-O4 | Q8 | Sony WH-1000XM5 | amazon.sg | 310 SGD | in_stock | https://www.amazon.sg/dp/B09ZFD9CBB?language=en_SG&th=1 | Sony WH-1000XM5 Noise Cancelling Wireless Over-Ear Headphones, Bluetooth, Clear Call Quality, Hi-Res, Up to 30hr Battery Life, Quick Charge, Alexa & Google Assistant, iOS & Android - Black | main list |  |  | FAIL: Exa currency S$ vs shown SGD |
| Q8-O5 | Q8 | Sony WH-1000XM5 | mobyshop.com.sg | 279 USD | in_stock | https://mobyshop.com.sg/wearables/brands/sony/sony-wh-1000xm5.html | Sony WH-1000XM5 | Other markets |  |  | pass (equal) |
| Q8-O6 | Q8 | Sony WH-1000XM5 | tkfoto.com.sg | 329 USD | in_stock | https://tkfoto.com.sg/products/sony-wh-1000xm5-wireless-over-ear-noise-canceling-headphones | Sony WH-1000XM5 Wireless Over-Ear Noise-Canceling Headphones | Other markets |  |  | pass (equal) |

Total displayed offers: 35.

## Displayed images

Image rubric (imageAuditRubric):
- Right product: the image shows the card's product model (any colour or variant counts when the caption names the source page's product title; a different model, a bundle shot that hides the product, a logo, a banner, a placeholder, or a lifestyle photo where the product is not the subject does not).
- Attributed: the caption names the host of the page the image came from, and that page is one of the card's merchant offers or the manufacturer's page.

Threshold: failures allowed = max(1, floor(10% of displayed images)). The Revalidation column re-derives rules I1, I2 and I3 from the log.

| ID | Query | Card product | Source host | Source title | Dimensions | File | Revalidation | Audit (Right product; Attributed) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-I1 | Q1 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | electronics.sony.com | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | 1200x1050 webp, 35482 bytes | Q1-I1.webp | pass |  |
| Q1-I2 | Q1 | Sony WH-1000XM6 Wireless Noise Cancelling Headphones | electronics.sony.com | WH-1000XM6 Best Wireless Noise Cancelling Headphones \| Black | 1200x1050 webp, 27616 bytes | Q1-I2.webp | pass |  |
| Q3-I1 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | harveynorman.com.sg | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | 1536x900 avif, 4866 bytes | Q3-I1.avif | pass |  |
| Q3-I2 | Q3 | Sony WH-1000XM5 Midnight Blue Edition | harveynorman.com.sg | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | 1536x900 avif, 4866 bytes | Q3-I2.avif | pass |  |
| Q4-I1 | Q4 | Breville the Bambino Plus | harveynorman.com.sg | Breville The BambinoÂ® Plus - Stainless Steel (BES500BSS) | 1536x900 avif, 11120 bytes | Q4-I1.avif | FAIL: the caption does not name this candidate; the candidate list does not re-derive |  |
| Q5-I1 | Q5 | ã‚½ãƒ‹ãƒ¼ WH-1000XM5 | yodobashi.com | ã‚½ãƒ‹ãƒ¼ SONY ãƒ¯ã‚¤ãƒ¤ãƒ¬ã‚¹ãƒŽã‚¤ã‚ºã‚­ãƒ£ãƒ³ã‚»ãƒªãƒ³ã‚°ã‚¹ãƒ†ãƒ¬ã‚ªãƒ˜ãƒƒãƒ‰ã‚»ãƒƒãƒˆ ãƒ–ãƒ©ãƒƒã‚¯ WH-1000XM5 B | 250x250 jpeg, 5607 bytes | Q5-I1.jpg | FAIL: the caption does not name this candidate; the candidate list does not re-derive |  |
| Q7-I1 | Q7 | Bose QuietComfort Headphones (2nd Gen) | tkfoto.com.sg | Bose QuietComfort Headphones (2nd Gen) | 816x609 webp, 14152 bytes | Q7-I1.webp | pass |  |
| Q7-I2 | Q7 | Bose QuietComfort Headphones | metapod.com | Bose QuietComfort Headphones | 800x800 webp, 26404 bytes | Q7-I2.webp | pass |  |
| Q8-I1 | Q8 | Sony WH-1000XM5 | courts.com.sg | SONY Wireless Noise Cancellation Headphones (black) WH-1000XM5/BME | 1600x1600 jpeg, 55379 bytes | Q8-I1.jpg | pass |  |

Total displayed images: 9.

## Queries

- Q1 (US): completed, 3 request(s), 8 offer(s), 2 image(s) displayed
- Q2 (US): completed, 2 request(s), 4 offer(s), 0 image(s) displayed
- Q3 (SG): completed, 3 request(s), 7 offer(s), 2 image(s) displayed
- Q4 (SG): completed, 2 request(s), 1 offer(s), 1 image(s) displayed
- Q5 (JP): completed, 3 request(s), 5 offer(s), 1 image(s) displayed
- Q6 (JP): completed, 2 request(s), 0 offer(s), 0 image(s) displayed
- Q7 (SG): completed, 3 request(s), 4 offer(s), 2 image(s) displayed
- Q8 (SG): completed, 2 request(s), 6 offer(s), 1 image(s) displayed
