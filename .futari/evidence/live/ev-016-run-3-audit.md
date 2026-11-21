# EV-016 run 3 owner audit sheet

Run log: .futari/evidence/live/ev-016-run-3-20261121T083658Z.json (git 433f072ba4c2154dc504a3997781b01120980203).
Displayed image bytes (not committed): /Users/josiahwong/.claude/jobs/ab921430/tmp/ev016-run3-images. Full-page screenshots (not committed): /Users/josiahwong/.claude/jobs/ab921430/tmp/ev016-run3-shots.

Offer rubric (evals/cases/live-acceptance-v1-1.json auditRubric):
- Right product: the merchant page sells the candidate model (a colour variant counts; a different model or a bundle does not).
- Direct merchant: the URL is the merchant's own product page, not a review, aggregator, marketplace, search, or category page.
- Price display: the shown price, currency, and availability equal the values Exa returned for that URL in this run, as recorded in the run log.

Threshold: at least 90% of all displayed offers pass all three checks (main list and Other markets). Only the owner fills Right product and Direct merchant. Price display is prefilled by revalidation: the page's row equals the offer in the log, and the offer equals the summary Exa returned for that URL in this run.

## Displayed offers

| ID | Query | Card product | Merchant host | Price | Availability | URL | Page title (Exa) | Placement | Right product | Direct merchant | Price display |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-O1 | Q1 | Sony WH-1000XM5 Headphones | instacart.com | 169.99 USD | in_stock | https://www.instacart.com/store/products/27435482-sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black-each | Sony WH-1000XM5 Wireless Noise-Canceling Over-the-Ear Headphones - Black | main list |  |  | pass (equal) |
| Q1-O2 | Q1 | Sony WH-1000XM5 Headphones | electronics.sony.com | 198 USD | in_stock | https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-l | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | main list |  |  | pass (equal) |
| Q1-O3 | Q1 | Sony WH-1000XM5 Headphones | amazon.com | 199.95 USD | in_stock | https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones-Hands-Free/dp/B09XS7JWHH | Sony WH-1000XM5 Premium Noise Cancelling Wireless Headphones, Black | main list |  |  | pass (equal) |
| Q1-O4 | Q1 | Sony WH-1000XM5 Wireless Headphones | bestbuy.com | 291.99 USD | in_stock | https://www.bestbuy.com/product/sony-wh-1000xm5-noise-canceling-wireless-over-ear-headphones-international-model-silver/CXZ8QR99XP | Sony - WH-1000XM5 Noise-Canceling Wireless Over-Ear Headphones (International Version) - Silver | main list |  |  | pass (equal) |
| Q2-O1 | Q2 | Logitech MX Master 3S | logitech.com | 79.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-master-3s | MX Master 3s Wireless Mouse - 8K Optical Sensor \| Logitech | main list |  |  | pass (equal) |
| Q2-O2 | Q2 | Logitech MX Master 3S | staples.com | 79.99 USD | in_stock | https://www.staples.com/logitech-mx-master-3s-ergonomic-wireless-optical-usb-mouse-black-910-006556/product_24531798 | Logitech MX Master 3S Wireless Optical Bluetooth Mouse, Black (910-007500) \| Staples | main list |  |  | pass (equal) |
| Q2-O3 | Q2 | Logitech MX Master 3S | amazon.com | 118.99 USD | in_stock | https://www.amazon.com/Logitech-MX-Master-3S-Performance/dp/B0B11LJ69K | Logitech MX Master 3S Performance Wireless Mouse - Graphite With Bolt Reciever | main list |  |  | pass (equal) |
| Q2-O4 | Q2 | Logitech MX Vertical | ebay.com | 49.99 USD | in_stock | https://www.ebay.com/itm/167051732563 | Logitech MX Vertical Wireless Ergonomic Mouse Graphite | main list |  |  | pass (equal) |
| Q2-O5 | Q2 | Logitech MX Vertical | amazon.com | 90.05 USD | in_stock | https://www.amazon.com/Logitech-Mouse-MX-Vertical-910-005448/dp/B07FNHV4MW | Logitech Mouse MX Vertical, 910-005448 | main list |  |  | pass (equal) |
| Q2-O6 | Q2 | Logitech MX Vertical | logitech.com | 99.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-vertical-ergonomic-mouse | Logitech MX Vertical Ergonomic Wireless Mouse | main list |  |  | pass (equal) |
| Q2-O7 | Q2 | Logitech MX Vertical | adorama.com | 100.49 USD | in_stock | https://www.adorama.com/logitech-mx-vertical-advanced-ergonomic-wireless-mouse/p/logmxvaem | Logitech MX Vertical Advanced Ergonomic Mouse 910-005447 | main list |  |  | pass (equal) |
| Q2-O8 | Q2 | Logitech MX Vertical | bestbuy.com | 119 USD | in_stock | https://www.bestbuy.com/product/logitech-mx-vertical-advanced-wireless-optical-ergonomic-mouse-with-usb-and-bluetooth-connection-wireless-graphite/J7H7ZYX82S/sku/12326082 | Logitech - MX Vertical Advanced Wireless Optical Ergonomic Mouse with USB and Bluetooth Connection - Wireless - Graphite | main list |  |  | pass (equal) |
| Q3-O1 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation%2C-headphones-midnight-blue-wh-1000xm5%2Flme-IP183532.html | SONY Wireless Noise Cancelling Headphones (midnight Blue) WH-1000XM5/LME | main list |  |  | pass (equal) |
| Q3-O2 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation-headphones-black-wh-1000xm5%2Fbme-IP176694.html | SONY Wireless Noise Cancellation Headphones (black) WH-1000XM5/BME | main list |  |  | pass (equal) |
| Q3-O3 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | harveynorman.com.sg | 298 SGD | in_stock | https://www.harveynorman.com.sg/tv-and-audio/headphones-en/over-ear-headphones-en-2/sony-wh-1000xm5-lme-wireless-noise-cancelling-headphones-midnight-blue.html | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | main list |  |  | pass (equal) |
| Q3-O4 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | online.challenger.sg | 309 SGD | in_stock | https://online.challenger.sg/products/sony-wh-1000xm5-wireless-noise-cancelling-headphones-blue | Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Blue) | main list |  |  | pass (equal) |
| Q3-O5 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | metapod.com | 313 SGD | unknown | https://metapod.com/products/sony-wh-1000xm5-wireless-noise-cancelling-headphones | Sony WH-1000XM5 Noise Cancelling Wireless Headphones (XM5) | main list |  |  | pass (equal) |
| Q4-O1 | Q4 | Breville the Bambino Plus | harveynorman.com.sg | 698 SGD | in_stock | https://www.harveynorman.com.sg/home-appliances/small-kitchen-appliances-en/coffee-machines-en/breville-the-bambino-plus-stainless-steel-bes500bss.html | Breville The Bambino® Plus - Stainless Steel (BES500BSS) | main list |  |  | pass (equal) |
| Q5-O1 | Q5 | SONY WH-1000XM5（価格.com最安表示の販売店経由） | xprice.co.jp | 37997 JPY | in_stock | https://www.xprice.co.jp/d.php?id=300000000848601&status=1 | SONY WH-1000XM5 (B) ブラック [ワイヤレスヘッドホン] | main list |  |  | pass (equal) |
| Q7-O1 | Q7 | Bose Quietcomfort Over-Ear Headphones (Smoke White) | harveynorman.com.sg | 389 SGD | in_stock | https://www.harveynorman.com.sg/tv-and-audio/headphones-en/over-ear-headphones-en-2/bose-quietcomfort-over-ear-headphones-smoke-white.html | Bose Quietcomfort Over-Ear Headphones - Smoke White | main list |  |  | pass (equal) |
| Q7-O2 | Q7 | Bose QuietComfort Headphones (2nd Gen) | bose.sg | 429 SGD | in_stock | https://bose.sg/products/quietcomfort-headphones-2nd-gen | QuietComfort Headphones (2nd Gen) | main list |  |  | pass (equal) |
| Q7-O3 | Q7 | Bose QuietComfort Headphones (2nd Gen) | metapod.com | 429 SGD | in_stock | https://metapod.com/products/bose-quietcomfort-headphones-2nd-gen | Bose QuietComfort Headphones (2nd Gen) | main list |  |  | pass (equal) |
| Q7-O4 | Q7 | Bose QuietComfort Headphones (2nd Gen) | tkfoto.com.sg | 429 USD | preorder | https://tkfoto.com.sg/products/bose-quietcomfort-headphones-2nd-gen | Bose QuietComfort Headphones (2nd Gen) | Other markets |  |  | pass (equal) |
| Q8-O1 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation%2C-headphones-midnight-blue-wh-1000xm5%2Flme-IP183532.html | SONY Wireless Noise Cancellation, Headphones (midnight Blue) WH-1000XM5/LME | main list |  |  | pass (equal) |
| Q8-O2 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | courts.com.sg | 289 SGD | in_stock | https://www.courts.com.sg/sony-wireless-noise-cancellation-headphones-black-wh-1000xm5%2Fbme-IP176694.html | SONY Wireless Noise Cancellation Headphones (black) WH-1000XM5/BME | main list |  |  | pass (equal) |
| Q8-O3 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | harveynorman.com.sg | 298 SGD | in_stock | https://www.harveynorman.com.sg/tv-and-audio/headphones-en/over-ear-headphones-en-2/sony-wh-1000xm5-lme-wireless-noise-cancelling-headphones-midnight-blue.html | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | main list |  |  | pass (equal) |
| Q8-O4 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | online.challenger.sg | 309 SGD | in_stock | https://online.challenger.sg/products/sony-wh-1000xm5-wireless-noise-cancelling-headphones-black | Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Black) | main list |  |  | pass (equal) |
| Q8-O5 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | stereo.com.sg | 309 SGD | in_stock | https://www.stereo.com.sg/products/sony-wh1000xm5 | Sony WH1000XM5 Noise Cancelling Headphone – Stereo Electronics Pte Ltd | main list |  |  | pass (equal) |
| Q8-O6 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | amazon.sg | 310 SGD | in_stock | https://www.amazon.sg/dp/B09ZFD9CBB?language=en_SG&th=1 | Sony WH-1000XM5 Noise Cancelling Wireless Over-Ear Headphones, Bluetooth, Clear Call Quality, Hi-Res, Up to 30hr Battery Life, Quick Charge, Alexa & Google Assistant, iOS & Android - Black | main list |  |  | pass (equal) |
| Q8-O7 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | mobyshop.com.sg | 279 USD | in_stock | https://mobyshop.com.sg/wearables/type/sony-wh-1000xm5.html | Sony WH-1000XM5 | Other markets |  |  | pass (equal) |

Total displayed offers: 30.

## Displayed images

Image rubric (imageAuditRubric):
- Right product: the image shows the card's product model (any colour or variant counts when the caption names the source page's product title; a different model, a bundle shot that hides the product, a logo, a banner, a placeholder, or a lifestyle photo where the product is not the subject does not).
- Attributed: the caption names the host of the page the image came from, and that page is one of the card's merchant offers or the manufacturer's page.

Threshold: failures allowed = max(1, floor(10% of displayed images)). The Revalidation column re-derives rules I1, I2 and I3 from the log.

| ID | Query | Card product | Source host | Source title | Dimensions | File | Revalidation | Audit (Right product; Attributed) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-I1 | Q1 | Sony WH-1000XM5 Headphones | electronics.sony.com | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | 1200x1050 webp, 35482 bytes | Q1-I1.webp | pass |  |
| Q1-I2 | Q1 | Sony WH-1000XM5 Wireless Headphones | electronics.sony.com | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | 1200x1050 webp, 35482 bytes | Q1-I2.webp | pass |  |
| Q2-I1 | Q2 | Logitech MX Vertical | adorama.com | Logitech MX Vertical Advanced Ergonomic Mouse 910-005447 | 300x300 webp, 3696 bytes | Q2-I1.webp | pass |  |
| Q3-I1 | Q3 | Sony WH-1000XM5 Noise Cancelling Headphones | harveynorman.com.sg | Sony WH-1000XM5/LME Wireless Noise Cancelling Headphones - Midnight Blue | 1536x900 avif, 4866 bytes | Q3-I1.avif | pass |  |
| Q4-I1 | Q4 | Breville the Bambino Plus | harveynorman.com.sg | Breville The Bambino® Plus - Stainless Steel (BES500BSS) | 1536x900 avif, 11120 bytes | Q4-I1.avif | pass |  |
| Q4-I2 | Q4 | Breville The Bambino Plus - Stainless Steel | harveynorman.com.sg | Breville The Bambino® Plus - Stainless Steel (BES500BSS) | 1536x900 avif, 11120 bytes | Q4-I2.avif | pass |  |
| Q5-I1 | Q5 | SONY WH-1000XM5（価格.com最安表示の販売店経由） | xprice.co.jp | SONY WH-1000XM5 (B) ブラック [ワイヤレスヘッドホン] | 600x600 jpeg, 28439 bytes | Q5-I1.jpg | pass |  |
| Q7-I1 | Q7 | Bose Quietcomfort Over-Ear Headphones (Smoke White) | harveynorman.com.sg | Bose Quietcomfort Over-Ear Headphones - Smoke White | 1536x900 avif, 8465 bytes | Q7-I1.avif | pass |  |
| Q7-I2 | Q7 | Bose QuietComfort Headphones (2nd Gen) | tkfoto.com.sg | Bose QuietComfort Headphones (2nd Gen) | 816x609 webp, 14152 bytes | Q7-I2.webp | pass |  |
| Q8-I1 | Q8 | Sony WH-1000XM5 Wireless Noise-Cancelling Headphones | online.challenger.sg | Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Black) | 800x800 webp, 13170 bytes | Q8-I1.webp | pass |  |

Total displayed images: 10.

## Queries

- Q1 (US): completed, 3 request(s), 4 offer(s), 2 image(s) displayed
- Q2 (US): completed, 3 request(s), 8 offer(s), 1 image(s) displayed
- Q3 (SG): completed, 2 request(s), 5 offer(s), 1 image(s) displayed
- Q4 (SG): completed, 3 request(s), 1 offer(s), 2 image(s) displayed
- Q5 (JP): completed, 3 request(s), 1 offer(s), 1 image(s) displayed
- Q6 (JP): completed, 2 request(s), 0 offer(s), 0 image(s) displayed
- Q7 (SG): completed, 3 request(s), 4 offer(s), 2 image(s) displayed
- Q8 (SG): completed, 3 request(s), 7 offer(s), 1 image(s) displayed
