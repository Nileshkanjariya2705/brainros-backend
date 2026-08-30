import { SeedContext, SeederResult } from './types';
import {
  OrderStatus,
  PaymentStatus,
  PaymentGateway,
} from '@prisma/client';

export async function seedOrdersAndRevenue(ctx: SeedContext): Promise<SeederResult> {
  const start = Date.now();
  const created: Record<string, number> = {};
  const reused: Record<string, number> = {};

  const inc = (type: string, isNew: boolean) => {
    if (isNew) created[type] = (created[type] || 0) + 1;
    else reused[type] = (reused[type] || 0) + 1;
  };

  const { prisma } = ctx;
  const salesAgent = ctx.users.get('sales01@brainros.test') || (await prisma.user.findFirst({
    where: { userRoles: { some: { role: { name: 'SALES_AGENT' } } } },
  }));

  const studentsList = Array.from(ctx.students.values());
  const examTargetsList = Array.from(ctx.examTargets.values());
  const examsList = Array.from(ctx.exams.values());

  const now = new Date();

  // Package / Item Configurations
  const packages = [
    { name: 'NEET 2026 Ultimate Test Series', type: 'EXAM_SERIES', amount: 4999, target: 'NEET' },
    { name: 'JEE Main + Advanced Complete Mock Pack', type: 'EXAM_SERIES', amount: 5999, target: 'JEE' },
    { name: 'MHT-CET FastTrack Crash Course', type: 'CRASH_COURSE', amount: 2999, target: 'CET' },
    { name: 'National Scholarship Test Pass', type: 'TEST_PASS', amount: 999, target: 'NEET' },
    { name: 'Physics Masterclass Test Pack', type: 'SUBJECT_PACK', amount: 1499, target: 'JEE' },
    { name: 'Allen Coaching Institutional Bundle', type: 'INSTITUTION_LICENSE', amount: 24999, target: 'NEET' },
  ];

  // 1. Seed Orders & Payments
  let orderIndex = 1;
  for (let i = 0; i < studentsList.length; i++) {
    const student = studentsList[i];
    const pkg = packages[i % packages.length];
    const examTarget = examTargetsList.find((t) => t.name.includes(pkg.target)) || examTargetsList[0];
    const exam = examsList[i % examsList.length];

    // Distribute order dates across the last 60 days
    const daysAgo = (i * 2) % 60;
    const orderDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - ((i * 37) % 86400) * 1000);

    // Determine status: ~75% COMPLETED, ~10% PENDING, ~10% FAILED, ~5% REFUNDED
    let orderStatus: OrderStatus = OrderStatus.COMPLETED;
    let paymentStatus: PaymentStatus = PaymentStatus.SUCCESS;
    let refundedAmt = 0;
    let refundedDate: Date | null = null;

    if (i % 10 === 7) {
      orderStatus = OrderStatus.PENDING;
      paymentStatus = PaymentStatus.INITIATED;
    } else if (i % 10 === 8) {
      orderStatus = OrderStatus.FAILED;
      paymentStatus = PaymentStatus.FAILED;
    } else if (i % 15 === 0 && i > 0) {
      orderStatus = OrderStatus.REFUNDED;
      paymentStatus = PaymentStatus.REFUNDED;
      refundedAmt = pkg.amount;
      refundedDate = new Date(orderDate.getTime() + 2 * 24 * 60 * 60 * 1000);
    }

    const orderNum = `ORD-2026-${String(orderIndex).padStart(5, '0')}`;
    const paymentNum = `PAY-2026-${String(orderIndex).padStart(5, '0')}`;
    const isSalesAgentAttributed = i % 2 === 0 && Boolean(salesAgent);

    const existingOrder = await prisma.order.findUnique({
      where: { orderNumber: orderNum },
    });

    if (!existingOrder) {
      await prisma.order.create({
        data: {
          orderNumber: orderNum,
          userId: student.userId,
          studentId: student.id,
          salesAgentId: isSalesAgentAttributed && salesAgent ? salesAgent.id : null,
          examTargetId: examTarget ? examTarget.id : null,
          examId: exam ? exam.id : null,
          amount: pkg.amount,
          currency: 'INR',
          status: orderStatus,
          itemType: pkg.type,
          itemName: pkg.name,
          createdAt: orderDate,
          updatedAt: orderDate,
          payments: {
            create: {
              paymentNumber: paymentNum,
              amount: pkg.amount,
              currency: 'INR',
              gateway: i % 3 === 0 ? PaymentGateway.RAZORPAY : i % 3 === 1 ? PaymentGateway.UPI : PaymentGateway.STRIPE,
              gatewayPaymentId: paymentStatus === PaymentStatus.SUCCESS ? `pay_rzp_${orderIndex}x99` : null,
              gatewayOrderId: `order_rzp_${orderIndex}ab7`,
              status: paymentStatus,
              paidAt: paymentStatus === PaymentStatus.SUCCESS || paymentStatus === PaymentStatus.REFUNDED ? orderDate : null,
              refundedAmount: refundedAmt,
              refundedAt: refundedDate,
              createdAt: orderDate,
              updatedAt: refundedDate || orderDate,
            },
          },
        },
      });
      inc('orders', true);
      inc('payments', true);
    } else {
      inc('orders', false);
      inc('payments', false);
    }
    orderIndex++;
  }

  // 2. Seed Sales Agent Leads (if sales agent exists)
  if (salesAgent) {
    const leadConfigs = [
      { name: 'Rohan Deshmukh', phone: '+919820011001', email: 'rohan.d@gmail.com', state: 'Maharashtra', district: 'Pune', exam: 'NEET', status: 'CONVERTED' },
      { name: 'Priya Sharma', phone: '+919820011002', email: 'priya.s@yahoo.com', state: 'Gujarat', district: 'Ahmedabad', exam: 'JEE', status: 'CONVERTED' },
      { name: 'Amit Patel', phone: '+919820011003', email: 'amit.p@outlook.com', state: 'Gujarat', district: 'Surat', exam: 'NEET', status: 'QUALIFIED' },
      { name: 'Kavita Joshi', phone: '+919820011004', email: 'kavita.j@gmail.com', state: 'Rajasthan', district: 'Kota', exam: 'JEE', status: 'CONTACTED' },
      { name: 'Sunil Verma', phone: '+919820011005', email: 'sunil.v@gmail.com', state: 'Madhya Pradesh', district: 'Indore', exam: 'NEET', status: 'NEW' },
      { name: 'Ananya Roy', phone: '+919820011006', email: 'ananya.r@gmail.com', state: 'Maharashtra', district: 'Mumbai', exam: 'CET', status: 'CONVERTED' },
      { name: 'Vikram Singh', phone: '+919820011007', email: 'vikram.s@gmail.com', state: 'Rajasthan', district: 'Jaipur', exam: 'JEE', status: 'LOST' },
      { name: 'Neha Kulkarni', phone: '+919820011008', email: 'neha.k@gmail.com', state: 'Maharashtra', district: 'Nagpur', exam: 'NEET', status: 'QUALIFIED' },
    ];

    for (let l = 0; l < leadConfigs.length; l++) {
      const cfg = leadConfigs[l];
      const leadDate = new Date(now.getTime() - (l * 4 + 1) * 24 * 60 * 60 * 1000);
      const studentMatch = cfg.status === 'CONVERTED' && studentsList[l % studentsList.length] ? studentsList[l % studentsList.length] : null;

      const existingLead = await prisma.salesLead.findFirst({
        where: { leadPhone: cfg.phone },
      });

      if (!existingLead) {
        await prisma.salesLead.create({
          data: {
            salesAgentId: salesAgent.id,
            studentId: studentMatch ? studentMatch.id : null,
            leadName: cfg.name,
            leadPhone: cfg.phone,
            leadEmail: cfg.email,
            state: cfg.state,
            district: cfg.district,
            targetExam: cfg.exam,
            status: cfg.status,
            convertedAt: cfg.status === 'CONVERTED' ? new Date(leadDate.getTime() + 24 * 3600 * 1000) : null,
            notes: `Interested in ${cfg.exam} online mock test packages.`,
            createdAt: leadDate,
            updatedAt: leadDate,
          },
        });
        inc('sales_leads', true);
      } else {
        inc('sales_leads', false);
      }
    }
  }

  const timeMs = Date.now() - start;
  return {
    seederName: 'Orders, Payments & Revenue Pipeline',
    createdCounts: created,
    reusedCounts: reused,
    timeMs,
  };
}
