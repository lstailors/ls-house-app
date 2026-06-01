// L&S House — seed data for dev/preview.
// Run with: bun run src/scripts/seed.ts
// Idempotent: clears domain data first, then reseeds.

import "../env";
import { auth } from "../lib/auth";
import { prisma } from "../lib/db";

const DEV_PASSWORD = "LStailors2026!";

async function clear() {
  console.log("→ Clearing domain data…");
  await prisma.communication.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.customOrder.deleteMany();
  await prisma.alteration.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.tailor.deleteMany();
  await prisma.styleLibrary.deleteMany();
  await prisma.fabricPricing.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.location.deleteMany();
}

async function createUser(opts: {
  name: string;
  email: string;
  role: string;
  locationId: string | null;
}) {
  const res = await auth.api.signUpEmail({
    body: { name: opts.name, email: opts.email, password: DEV_PASSWORD },
  });
  if (!res?.user) throw new Error(`Failed to create user ${opts.email}`);
  const updated = await prisma.user.update({
    where: { id: res.user.id },
    data: {
      role: opts.role,
      locationId: opts.locationId,
      emailVerified: true,
    },
  });
  return updated;
}

async function main() {
  await clear();

  console.log("→ Creating locations…");
  const ny = await prisma.location.create({
    data: {
      name: "New York",
      address: "138 East 61st St, New York, NY 10065",
      erpnextCompanyOrBranch: "LS-NY",
      isActive: true,
    },
  });
  const houston = await prisma.location.create({
    data: {
      name: "Houston",
      address: "2402 Westheimer Rd, Houston, TX 77098",
      erpnextCompanyOrBranch: "LS-HOU",
      isActive: true,
    },
  });

  console.log("→ Creating users…");
  const superAdmin = await createUser({
    name: "Alexander Whitfield",
    email: "superadmin@lstailors.com",
    role: "super_admin",
    locationId: null,
  });
  const nyManager = await createUser({
    name: "Marcus Donovan",
    email: "nymanager@lstailors.com",
    role: "store_manager",
    locationId: ny.id,
  });
  const houstonManager = await createUser({
    name: "Elena Vasquez",
    email: "houstonmanager@lstailors.com",
    role: "store_manager",
    locationId: houston.id,
  });
  const nySales = await createUser({
    name: "James Caldwell",
    email: "nysales@lstailors.com",
    role: "salesperson",
    locationId: ny.id,
  });
  const nySales2 = await createUser({
    name: "Olivia Chen",
    email: "nysales2@lstailors.com",
    role: "salesperson",
    locationId: ny.id,
  });
  const houstonSales = await createUser({
    name: "Diego Marquez",
    email: "houstonsales@lstailors.com",
    role: "salesperson",
    locationId: houston.id,
  });
  const driver = await createUser({
    name: "Andre Sutton",
    email: "driver@lstailors.com",
    role: "driver",
    locationId: ny.id,
  });

  console.log("→ Creating tailors…");
  const tailorGiuseppe = await prisma.tailor.create({
    data: { name: "Giuseppe Romano", locationId: ny.id, isActive: true },
  });
  const tailorHans = await prisma.tailor.create({
    data: { name: "Hans Müller", locationId: ny.id, isActive: true },
  });
  const tailorRafa = await prisma.tailor.create({
    data: { name: "Rafael Ortiz", locationId: houston.id, isActive: true },
  });
  const tailorYuki = await prisma.tailor.create({
    data: { name: "Yuki Tanaka", locationId: houston.id, isActive: true },
  });

  console.log("→ Creating fabrics…");
  const fabrics = await Promise.all([
    prisma.fabricPricing.create({
      data: {
        fabricName: "Loro Piana Super 150s Wool",
        mill: "Loro Piana",
        composition: "100% Wool",
        weight: "260g",
        season: "Four Season",
        tier: "Signature",
        price: 4200,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Zegna Trofeo 600",
        mill: "Ermenegildo Zegna",
        composition: "100% Wool",
        weight: "240g",
        season: "Spring/Summer",
        tier: "Premium",
        price: 3800,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Dormeuil Royal Ascot",
        mill: "Dormeuil",
        composition: "100% Wool",
        weight: "280g",
        season: "Fall/Winter",
        tier: "Signature",
        price: 4400,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Holland & Sherry Cashmere Blend",
        mill: "Holland & Sherry",
        composition: "85% Wool / 15% Cashmere",
        weight: "320g",
        season: "Fall/Winter",
        tier: "Bespoke",
        price: 5600,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Scabal Diamond Chip",
        mill: "Scabal",
        composition: "Wool / Diamond Dust",
        weight: "260g",
        season: "Four Season",
        tier: "Bespoke",
        price: 7800,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Vitale Barberis Canonico Revenge",
        mill: "VBC",
        composition: "100% Wool",
        weight: "320g",
        season: "Fall/Winter",
        tier: "Standard",
        price: 2400,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Drapers Stratos",
        mill: "Drapers",
        composition: "100% Wool",
        weight: "230g",
        season: "Spring/Summer",
        tier: "Premium",
        price: 3200,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Albini Royal Twill Cotton",
        mill: "Albini",
        composition: "100% Cotton",
        weight: "120g",
        season: "Four Season",
        tier: "Standard",
        price: 320,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Thomas Mason Goldline Poplin",
        mill: "Thomas Mason",
        composition: "100% Cotton",
        weight: "110g",
        season: "Four Season",
        tier: "Premium",
        price: 420,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Carlo Riva Sea Island",
        mill: "Carlo Riva",
        composition: "100% Cotton",
        weight: "100g",
        season: "Spring/Summer",
        tier: "Signature",
        price: 680,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Caccioppoli Linen",
        mill: "Caccioppoli",
        composition: "100% Linen",
        weight: "260g",
        season: "Spring/Summer",
        tier: "Standard",
        price: 1800,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Fox Brothers Flannel",
        mill: "Fox Brothers",
        composition: "100% Wool",
        weight: "380g",
        season: "Fall/Winter",
        tier: "Premium",
        price: 2900,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Cerruti Tropical Wool",
        mill: "Cerruti",
        composition: "100% Wool",
        weight: "210g",
        season: "Spring/Summer",
        tier: "Standard",
        price: 2200,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Reda Active Performance",
        mill: "Reda",
        composition: "Wool / Stretch",
        weight: "250g",
        season: "Four Season",
        tier: "Standard",
        price: 2400,
        isActive: true,
      },
    }),
    prisma.fabricPricing.create({
      data: {
        fabricName: "Solbiati Irish Linen",
        mill: "Solbiati",
        composition: "100% Linen",
        weight: "230g",
        season: "Spring/Summer",
        tier: "Premium",
        price: 2700,
        isActive: true,
      },
    }),
  ]);

  console.log("→ Creating style options…");
  const styleData = [
    { category: "lapel", name: "Notch", description: "Classic single-breasted notch lapel" },
    { category: "lapel", name: "Peak", description: "Sharper, more formal peak lapel" },
    { category: "lapel", name: "Shawl", description: "Curved shawl collar (formalwear)" },
    { category: "pocket", name: "Flap", description: "Standard flap pockets" },
    { category: "pocket", name: "Jetted", description: "Clean, formal jetted pockets" },
    { category: "pocket", name: "Patch", description: "Casual, sporty patch pockets" },
    { category: "vent", name: "Single Vent", description: "American single vent" },
    { category: "vent", name: "Double Vent", description: "English double side vent" },
    { category: "vent", name: "No Vent", description: "Italian style, no vent" },
    { category: "lining", name: "Bemberg Cupro", description: "Standard breathable lining" },
    { category: "lining", name: "Silk Twill", description: "Luxury silk lining" },
    { category: "lining", name: "Half-Canvas", description: "Half-canvas construction" },
    { category: "button", name: "Horn", description: "Genuine buffalo horn buttons" },
    { category: "button", name: "Mother of Pearl", description: "MOP buttons (formalwear)" },
    { category: "button", name: "Corozo", description: "Sustainable corozo nut buttons" },
    { category: "collar", name: "Cutaway", description: "Spread cutaway collar" },
    { category: "collar", name: "Semi-spread", description: "Versatile semi-spread" },
    { category: "collar", name: "Button-down", description: "Casual button-down collar" },
    { category: "cuff", name: "Barrel", description: "Standard rounded barrel cuff" },
    { category: "cuff", name: "French", description: "Double cuff for cufflinks" },
    { category: "placket", name: "Standard", description: "Standard front placket" },
    { category: "placket", name: "French", description: "No placket, clean front" },
  ];

  for (const s of styleData) {
    await prisma.styleLibrary.create({ data: { ...s, isActive: true } });
  }

  console.log("→ Creating customers…");
  const customerSeeds = [
    { name: "Reginald Ashford III", phone: "+12125550101", email: "r.ashford@hartwell.com", loc: ny, by: nySales, vip: true },
    { name: "Charles Sutherland", phone: "+12125550102", email: "csutherland@law.com", loc: ny, by: nySales, vip: false },
    { name: "William Pemberton", phone: "+12125550103", email: "wp@pemberton-cap.com", loc: ny, by: nySales2, vip: true },
    { name: "Theodore Bancroft", phone: "+12125550104", email: "ted@bancroft.io", loc: ny, by: nySales2, vip: false },
    { name: "Edward Hawthorne", phone: "+12125550105", email: null, loc: ny, by: nyManager, vip: false },
    { name: "Frederick Ashworth", phone: "+17135550201", email: "f.ashworth@energy.tx", loc: houston, by: houstonSales, vip: true },
    { name: "Beauregard Calhoun", phone: "+17135550202", email: "beau@calhoun-oil.com", loc: houston, by: houstonSales, vip: true },
    { name: "Davenport Wells", phone: "+17135550203", email: null, loc: houston, by: houstonSales, vip: false },
    { name: "Sterling Whitmore", phone: "+17135550204", email: "swhitmore@whitmore.law", loc: houston, by: houstonManager, vip: false },
    { name: "Augustus Pierce", phone: "+17135550205", email: "augie@pierce-medical.com", loc: houston, by: houstonManager, vip: false },
  ];

  const customers = [];
  for (const cs of customerSeeds) {
    const c = await prisma.customer.create({
      data: {
        name: cs.name,
        phone: cs.phone,
        email: cs.email,
        locationId: cs.loc.id,
        createdById: cs.by.id,
        dossierJson: JSON.stringify({
          preferences: cs.vip ? "Prefers Loro Piana, peak lapel, side vents." : "Notch lapel, flap pockets.",
          measurements: { chest: 42, waist: 34, sleeve: 25.5, inseam: 32 },
          vip: cs.vip,
          notes: cs.vip ? "VIP — discrete service, no waiting room." : "",
        }),
      },
    });
    customers.push({ ...cs, record: c });
  }

  console.log("→ Creating alterations…");
  const altSeeds = [
    { customer: customers[0], status: "in_progress", tailor: tailorGiuseppe, price: 240, items: [{ label: "Hem trousers", price: 60 }, { label: "Take in waist 1\"", price: 80 }, { label: "Shorten sleeves", price: 100 }], dueDays: 3, by: nySales },
    { customer: customers[1], status: "intake", tailor: null, price: 120, items: [{ label: "Hem 2 pairs trousers", price: 120 }], dueDays: 5, by: nySales },
    { customer: customers[2], status: "ready", tailor: tailorHans, price: 380, items: [{ label: "Recut jacket shoulders", price: 280 }, { label: "Adjust button stance", price: 100 }], dueDays: -1, by: nySales2 },
    { customer: customers[3], status: "in_progress", tailor: tailorGiuseppe, price: 90, items: [{ label: "Press 3 suits", price: 90 }], dueDays: 1, by: nySales2 },
    { customer: customers[4], status: "picked_up", tailor: tailorHans, price: 60, items: [{ label: "Hem trousers", price: 60 }], dueDays: -7, by: nyManager },
    { customer: customers[5], status: "in_progress", tailor: tailorRafa, price: 180, items: [{ label: "Take in waist 1.5\"", price: 100 }, { label: "Shorten sleeves 1\"", price: 80 }], dueDays: 2, by: houstonSales },
    { customer: customers[6], status: "intake", tailor: null, price: 320, items: [{ label: "Recut jacket waist", price: 220 }, { label: "Cuff trousers", price: 100 }], dueDays: 6, by: houstonSales },
    { customer: customers[7], status: "ready", tailor: tailorYuki, price: 140, items: [{ label: "Shorten 2 pairs trousers", price: 140 }], dueDays: 0, by: houstonSales },
  ];

  for (const a of altSeeds) {
    const due = new Date();
    due.setDate(due.getDate() + a.dueDays);
    await prisma.alteration.create({
      data: {
        customerId: a.customer.record.id,
        locationId: a.customer.loc.id,
        itemsJson: JSON.stringify(a.items),
        price: a.price,
        status: a.status,
        tailorId: a.tailor?.id ?? null,
        dueDate: due,
        createdById: a.by.id,
      },
    });
  }

  console.log("→ Creating custom orders…");
  const customSeeds = [
    { customer: customers[0], type: "suit", quoted: 6800, deposit: 3400, status: "in_production", by: nySales, fabric: fabrics[0], specName: "Peak lapel, double vent, silk lining" },
    { customer: customers[2], type: "jacket", quoted: 4200, deposit: 2100, status: "deposit_paid", by: nySales2, fabric: fabrics[3], specName: "Notch lapel, patch pockets, cashmere blend" },
    { customer: customers[3], type: "shirt", quoted: 480, deposit: 240, status: "ready", by: nySales2, fabric: fabrics[9], specName: "Cutaway collar, French cuff, Sea Island cotton" },
    { customer: customers[1], type: "trousers", quoted: 1200, deposit: 0, priceTbd: true, status: "quote", by: nySales, fabric: fabrics[6], specName: "Quote requested — fabric TBD" },
    { customer: customers[5], type: "suit", quoted: 7800, deposit: 4000, status: "in_production", by: houstonSales, fabric: fabrics[4], specName: "Peak lapel, jetted pockets, diamond chip wool" },
    { customer: customers[6], type: "overcoat", quoted: 5400, deposit: 2700, status: "in_production", by: houstonSales, fabric: fabrics[11], specName: "Notch lapel, fox brothers flannel" },
    { customer: customers[7], type: "vest", quoted: 1100, deposit: 550, status: "delivered", by: houstonSales, fabric: fabrics[2], specName: "5-button, double-breasted vest" },
    { customer: customers[8], type: "suit", quoted: 0, deposit: 0, priceTbd: true, status: "quote", by: houstonManager, fabric: fabrics[1], specName: "Awaiting consultation" },
  ];

  const createdCustomOrders = [];
  for (const co of customSeeds) {
    const spec = {
      fabricId: co.fabric.id,
      fabricName: co.fabric.fabricName,
      lapel: "Peak",
      pockets: "Jetted",
      vent: "Double Vent",
      lining: "Silk Twill",
      buttons: "Horn",
      notes: co.specName,
    };
    const order = await prisma.customOrder.create({
      data: {
        customerId: co.customer.record.id,
        locationId: co.customer.loc.id,
        garmentType: co.type,
        quotedPrice: co.quoted,
        priceTbd: !!co.priceTbd,
        depositAmount: co.deposit,
        status: co.status,
        notes: co.specName,
        specJson: JSON.stringify(spec),
        createdById: co.by.id,
      },
    });
    createdCustomOrders.push({ ...co, record: order });

    if (!co.priceTbd) {
      const so = await prisma.salesOrder.create({
        data: {
          customOrderId: order.id,
          locationId: co.customer.loc.id,
          erpnextId: `SO-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
          status: co.status === "delivered" ? "completed" : "active",
          total: co.quoted,
          payloadJson: JSON.stringify({
            source: "L&S House POS",
            garmentType: co.type,
            deposit: co.deposit,
          }),
        },
      });
      await prisma.invoice.create({
        data: {
          salesOrderId: so.id,
          locationId: co.customer.loc.id,
          erpnextId: `INV-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
          status: co.status === "delivered" ? "paid" : co.deposit > 0 ? "sent" : "draft",
          total: co.quoted,
          pdfUrl: null,
        },
      });
    }
  }

  console.log("→ Creating deliveries…");
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  await prisma.delivery.create({
    data: {
      orderRef: "DEL-NY-0001",
      customOrderId: createdCustomOrders[2].record.id,
      customerId: customers[3].record.id,
      locationId: ny.id,
      driverId: driver.id,
      status: "scheduled",
      scheduledAt: today,
      addressLine: "740 Park Ave, New York, NY 10021",
    },
  });
  await prisma.delivery.create({
    data: {
      orderRef: "DEL-NY-0002",
      customerId: customers[0].record.id,
      locationId: ny.id,
      driverId: driver.id,
      status: "out_for_delivery",
      scheduledAt: today,
      addressLine: "927 Fifth Ave, New York, NY 10021",
    },
  });
  await prisma.delivery.create({
    data: {
      orderRef: "DEL-NY-0003",
      customerId: customers[4].record.id,
      locationId: ny.id,
      driverId: driver.id,
      status: "delivered",
      scheduledAt: yesterday,
      deliveredAt: yesterday,
      addressLine: "15 Central Park West, New York, NY 10023",
      erpnextSynced: true,
    },
  });
  await prisma.delivery.create({
    data: {
      orderRef: "DEL-HOU-0001",
      customOrderId: createdCustomOrders[6].record.id,
      customerId: customers[7].record.id,
      locationId: houston.id,
      driverId: null,
      status: "delivered",
      scheduledAt: yesterday,
      deliveredAt: yesterday,
      addressLine: "5599 San Felipe St, Houston, TX 77056",
      erpnextSynced: true,
    },
  });
  await prisma.delivery.create({
    data: {
      orderRef: "DEL-HOU-0002",
      customerId: customers[5].record.id,
      locationId: houston.id,
      driverId: null,
      status: "scheduled",
      scheduledAt: tomorrow,
      addressLine: "3 Tiel Way, Houston, TX 77019",
    },
  });

  console.log("→ Creating communications…");
  const commSeeds = [
    {
      customer: customers[0],
      channel: "call",
      direction: "inbound",
      transcript: "Reginald: \"Marcus, I'd like to come by next Tuesday at 2pm for the final fitting.\" Marcus: \"Of course, sir. We'll have the Loro Piana suit ready and a Macallan waiting.\"",
      body: null,
      loc: ny,
    },
    {
      customer: customers[0],
      channel: "sms",
      direction: "outbound",
      transcript: null,
      body: "Mr. Ashford — your second fitting is scheduled for Tuesday 4 June at 2pm. — L&S House",
      loc: ny,
    },
    {
      customer: customers[2],
      channel: "sms",
      direction: "inbound",
      transcript: null,
      body: "Hi James — any chance we can move the fitting to Thursday?",
      loc: ny,
    },
    {
      customer: customers[2],
      channel: "sms",
      direction: "outbound",
      transcript: null,
      body: "Of course Mr. Pemberton — Thursday at 11am works perfectly. We'll be ready.",
      loc: ny,
    },
    {
      customer: customers[5],
      channel: "call",
      direction: "outbound",
      transcript: "Diego: \"Mr. Ashworth, the Scabal Diamond Chip arrived from Belgium. We can begin cutting tomorrow.\" Frederick: \"Wonderful. Will it be ready before the Houston Symphony Gala?\"",
      body: null,
      loc: houston,
    },
    {
      customer: customers[6],
      channel: "sms",
      direction: "outbound",
      transcript: null,
      body: "Mr. Calhoun — your Fox Brothers overcoat is in production. ETA 3 weeks. Estimated completion: 21 June.",
      loc: houston,
    },
  ];

  for (const cm of commSeeds) {
    await prisma.communication.create({
      data: {
        customerId: cm.customer.record.id,
        locationId: cm.loc.id,
        channel: cm.channel,
        direction: cm.direction,
        transcript: cm.transcript,
        body: cm.body,
      },
    });
  }

  console.log("\n✅ Seed complete.\n");
  console.log("Demo logins (password: " + DEV_PASSWORD + "):");
  console.log("  superadmin@lstailors.com         — Super Admin (all locations)");
  console.log("  nymanager@lstailors.com          — NY Store Manager");
  console.log("  nysales@lstailors.com            — NY Salesperson");
  console.log("  nysales2@lstailors.com           — NY Salesperson");
  console.log("  houstonmanager@lstailors.com     — Houston Store Manager");
  console.log("  houstonsales@lstailors.com       — Houston Salesperson");
  console.log("  driver@lstailors.com             — Driver\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
