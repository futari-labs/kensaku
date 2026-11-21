# EV-008 run 1 owner audit sheet

Run log: .futari/evidence/live/ev-008-run-1-20261121T005520Z.json (git 7bfa54f124ae7d5c94f4074c0de30e0f08ec8c12, 2026-11-21T00:55:21.263Z).

Rubric (evals/cases/live-acceptance.json auditRubric):
- Right product: the merchant page sells the candidate model (a colour variant counts; a different model or a bundle does not).
- Direct merchant: the URL is the merchant's own product page, not a review, aggregator, or search page.
- Price display: the shown price, currency, and availability equal the values Exa returned for that URL in this run, as recorded in the run log.

Threshold: at least 90% of all displayed offers pass all three checks. Only the owner fills Right product and Direct merchant. Price display is prefilled from the revalidation of the recorded Exa responses.

## Displayed offers

| ID | Query | Candidate | Merchant host | Price | Availability | URL | Page title (Exa) | Right product | Direct merchant | Price display |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q1-O1 | Q1 | Sony WH-1000XM5 Premium Wireless Noise Cancelling Headphones | instacart.com | 169.99 USD | in_stock | https://www.instacart.com/store/products/27435482-sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black-each | Sony WH-1000XM5 Wireless Noise-Canceling Over-the-Ear Headphones - Black | pending owner | pending owner | pass |
| Q1-O2 | Q1 | Sony WH-1000XM5 Premium Wireless Noise Cancelling Headphones | electronics.sony.com | 198 USD | in_stock | https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-s | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Silver | pending owner | pending owner | pass |
| Q1-O3 | Q1 | Sony WH-1000XM5 Premium Wireless Noise Cancelling Headphones | adorama.com | 278 USD | in_stock | https://www.adorama.com/sony-wh-1000xm5-wireless-noise-cancelling-headphones/p/sowh1xm5b | Sony WH-1000XM5 Wireless Closed-Back Over-Ear Noise Cancelling Headphones, Black WH1000XM5/B | pending owner | pending owner | pass |
| Q2-O1 | Q2 | Logitech Logitech MX Vertical | amazon.com | 90.05 USD | in_stock | https://www.amazon.com/Logitech-Mouse-MX-Vertical-910-005448/dp/B07FNHV4MW | Logitech Mouse MX Vertical, 910-005448 | pending owner | pending owner | pass |
| Q2-O2 | Q2 | Logitech Logitech MX Vertical | logitech.com | 99.99 USD | in_stock | https://www.logitech.com/en-us/shop/p/mx-vertical-ergonomic-mouse | Logitech MX Vertical Ergonomic Wireless Mouse | pending owner | pending owner | pass |
| Q2-O3 | Q2 | Logitech Logitech MX Vertical | adorama.com | 100.49 USD | in_stock | https://www.adorama.com/logitech-mx-vertical-advanced-ergonomic-wireless-mouse/p/logmxvaem | Logitech MX Vertical Advanced Ergonomic Mouse 910-005447 | pending owner | pending owner | pass |
| Q3-O1 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | instacart.com | 169.99 USD | in_stock | https://www.instacart.com/store/products/27435482-sony-wh-1000xm5-wireless-noise-canceling-over-the-ear-headphones-black-each | Sony WH-1000XM5 Wireless Noise-Canceling Over-the-Ear Headphones - Black | pending owner | pending owner | pass |
| Q3-O2 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | electronics.sony.com | 198 USD | in_stock | https://electronics.sony.com/audio/headphones/headband/p/wh1000xm5-l | WH-1000XM5 Premium Wireless Noise Cancelling Headphones \| Midnight Blue | pending owner | pending owner | pass |
| Q3-O3 | Q3 | Sony WH-1000XM5 Wireless Noise Cancelling Headphones | rakuten.com | 229.99 USD | in_stock | https://www.rakuten.com/products/sony-wh-1000xm5-premium-wireless/00027242923232_upc | Sony - WH-1000XM5 Wireless Noise Cancelling Over-the-Ear Headphones - Black | pending owner | pending owner | pass |
| Q5-O1 | Q5 | ソニー (Sony) WH-1000XM5 | search.rakuten.co.jp | 33726 JPY | in_stock | https://search.rakuten.co.jp/search/mall/%E3%82%BD%E3%83%8B%E3%83%BC+wh-1000xm5/ | SONY WH-1000XM5 WH-1000XM5 SM プラチナシルバー | pending owner | pending owner | pass |
| Q5-O2 | Q5 | ソニー (Sony) WH-1000XM5 | edion.com | 51000 JPY | in_stock | https://www.edion.com/detail.html?p_cd=00071159386 | SONY WH-1000XM5 B ワイヤレスノイズキャンセリングステレオヘッドセット ブラック | pending owner | pending owner | pass |
| Q5-O3 | Q5 | ソニー (Sony) WH-1000XM5 | store.shopping.yahoo.co.jp | 54780 JPY | in_stock | https://store.shopping.yahoo.co.jp/e-earphone/4548736132566.html | SONY WH-1000XM5 BM ブラック ソニー ワイヤレスヘッドホン ノイズキャンセリング Bluetooth ブルートゥース ヘッドフォン WH1000XM5BM | pending owner | pending owner | pass |
| Q5-O4 | Q5 | ソニー (Sony) WH-1000XM5 | fujiya-avic.co.jp | 56100 JPY | in_stock | https://www.fujiya-avic.co.jp/shop/g/g200000062737/ | SONY WH-1000XM5 BM ブラック 新品 | pending owner | pending owner | pass |
| Q5-O5 | Q5 | ソニー (Sony) WH-1000XM5 | sony.jp | 56100 JPY | in_stock | https://www.sony.jp/headphone/products/WH-1000XM5/ | WH-1000XM5 | pending owner | pending owner | pass |
| Q5-O6 | Q5 | ソニー (Sony) WH-1000XM6 | e-earphone.jp | 59400 JPY | in_stock | https://www.e-earphone.jp/products/586956 | SONY WH-1000XM6 | pending owner | pending owner | pass |
| Q5-O7 | Q5 | ソニー (Sony) WH-1000XM6 | sony.jp | 59400 JPY | in_stock | https://www.sony.jp/headphone/products/WH-1000XM6/ | WH-1000XM6 | pending owner | pending owner | pass |

Total displayed offers: 16.

## Queries

- Q1 (US): completed, 2 request(s), 3 offer(s) displayed
- Q2 (US): completed, 3 request(s), 3 offer(s) displayed
- Q3 (SG): completed, 2 request(s), 3 offer(s) displayed
- Q4 (SG): completed, 2 request(s), 0 offer(s) displayed
- Q5 (JP): completed, 3 request(s), 7 offer(s) displayed
- Q6 (JP): completed, 2 request(s), 0 offer(s) displayed

## Comparison citations

- Q1: 7 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
- Q2: 4 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
- Q3: 7 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
- Q4: 5 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
- Q5: 3 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
- Q6: 6 resolved source URL(s), 0 unresolved marker(s), uncited paragraph indexes [], displayed text equals the recomputed rendering: true
