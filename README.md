# SCGP Water Management Dashboard

ติดตามสถานการณ์น้ำของสถานประกอบการ SCGP (24 พื้นที่ / 27 บริษัท) ตาม **7 Risk Trigger Point**
จากข้อมูลเปิดของหน่วยงานรัฐ — ใช้ประกอบการตัดสินใจ BCM

| # | Trigger | แหล่งข้อมูล |
|---|---------|-------------|
| 1 | ระดับน้ำเขื่อน (เทียบ Rule Curve ของ กฟผ.) | กรมชลประทาน, กฟผ. |
| 2 | น้ำไหลออก / ระบายจากเขื่อน | กรมชลประทาน, กฟผ. |
| 3 | ระดับท่าน้ำ (ม.รทก.) | สสน., กรมชลประทาน, กฟผ. |
| 4 | ระดับตลิ่ง | สสน. |
| 5 | ปริมาณน้ำฝน 24 ชม. | สสน. (รวมกรมอุตุฯ / ทน.) |
| 6 | ระดับท่อ / น้ำท่วมขัง | สำนักการระบายน้ำ กทม. |
| 7 | น้ำทะเลหนุน | สสน. (ป้อมพระจุลจอมเกล้า, ปากรอ) |

## โครงสร้าง

```
index.html               หน้าเข้าสู่ระบบ (SCG SSO) — สร้างจาก src/login.html
dashboard.html           หน้า Dashboard หลังเข้าสู่ระบบ — สร้างจาก src/template.html + src/app.js
api/config.js            ค่าตั้งค่าสาธารณะสำหรับหน้าเว็บ (เปิด/ปิด SSO, Supabase URL, โดเมนที่อนุญาต)
assets/                  โลโก้ SCGP
api/water.js             Vercel Function: ดึง สสน. + กฟผ. แบบ real-time, เก็บประวัติลง Supabase
api/_lib/                transform.js + sites.json (คัดลอกจาก src/ และ data/ ตอน build)
src/                     template.html, app.js (หน้าเว็บ), transform.js (ใช้ร่วมกับ API)
data/                    sites.json (ที่ตั้ง SCGP), snapshot.json (ข้อมูลสำรอง), region.geo.json (ขอบเขตประเทศ)
supabase/migrations/     schema "water" (sites, site_contacts, criteria, snapshots)
```

## แก้ไขแล้ว deploy

```bash
python3 build.py      # สร้าง index.html ใหม่จาก src/ และ data/
git commit -am "..." && git push   # Vercel deploy อัตโนมัติ
```

- ปรับเกณฑ์: ตัวแปร `CRITERIA` ใน `src/app.js` (ค่าอ้างอิงเก็บไว้ในตาราง `water.criteria` ด้วย)
- ปรับพื้นที่/โซน/เขื่อน: `data/sites.json` (และตาราง `water.sites`)
- ชื่อ BCM Coordinator ไม่อยู่ใน repo นี้ เก็บในตาราง `water.site_contacts` (ไม่เปิดผ่าน API)

## เปิดใช้ SCG SSO (Microsoft Entra ID ผ่าน Supabase Auth)

1. ทีม IT ลงทะเบียนแอปใน Microsoft Entra ID ของ SCG
   - Redirect URI: `https://ptvhlvinsmlzqamvhgrz.supabase.co/auth/v1/callback`
   - ได้ค่า Application (client) ID, Client secret, Tenant URL (`https://login.microsoftonline.com/<tenant-id>`)
2. Supabase → Authentication → Providers → **Azure** → เปิดใช้ แล้วใส่ค่าจากข้อ 1
3. Supabase → Authentication → URL Configuration → เพิ่ม `https://scgp-water-management.vercel.app/dashboard.html` ใน Redirect URLs
4. Vercel → Environment Variables → `SSO_ENABLED=true` (และ `SSO_ALLOWED_DOMAINS=scg.com` ถ้าต้องการโดเมนอื่นเพิ่ม คั่นด้วย ,) แล้ว Redeploy

ก่อนเปิด SSO หน้าเข้าสู่ระบบจะแสดงปุ่ม "เข้าดู Dashboard (โหมดทดลอง)" และหัว Dashboard แสดงป้าย "โหมดทดลอง"

## Environment variables (Vercel)

| Key | ค่า |
|-----|-----|
| `SUPABASE_URL` | URL ของโปรเจกต์ Supabase |
| `SUPABASE_ANON_KEY` | publishable / anon key |
| `WATER_INGEST_KEY` | คีย์ที่ตรงกับ `water.app_secret` (ใช้บันทึก snapshot) |
| `SSO_ENABLED` | `true` เมื่อตั้งค่า Azure provider ใน Supabase เสร็จแล้ว |
| `SSO_ALLOWED_DOMAINS` | โดเมนอีเมลที่เข้าได้ (ค่าเริ่มต้น `scg.com`) |

## แหล่งข้อมูล
- คลังข้อมูลน้ำแห่งชาติ (สสน.) — https://www.thaiwater.net
- กรมชลประทาน — https://app.rid.go.th/reservoir/
- กฟผ. Water Intelligence Center — https://egatwater.egat.co.th
- สำนักการระบายน้ำ กทม. — https://weather.bangkok.go.th
