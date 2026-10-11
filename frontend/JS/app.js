(() => {
  const $ = (id) => document.getElementById(id);
  const money = (n) => new Intl.NumberFormat("id-ID", {style:"currency",currency:"IDR",maximumFractionDigits:0}).format(Number(n)||0);
  const WIB = "Asia/Jakarta";
  const wibParts = (date=new Date()) => Object.fromEntries(
    new Intl.DateTimeFormat("en-CA",{timeZone:WIB,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date)
      .filter(part=>part.type!=="literal").map(part=>[part.type,part.value])
  );
  const dateKey = (date=new Date()) => {
    const {year,month,day}=wibParts(date);
    return `${year}-${month}-${day}`;
  };
  const today = () => dateKey();
  const serviceCatalog = {
    kg: [
      {name:"Cuci kering - Reguler (2 hari)",price:4000,category:"Reguler (2 hari)"},
      {name:"Setrika - Reguler (2 hari)",price:2000,category:"Reguler (2 hari)"},
      {name:"Cuci + setrika - Reguler (2 hari)",price:5000,category:"Reguler (2 hari)"},
      {name:"Cuci kering - Express (24 jam)",price:6000,category:"Express (24 jam)"},
      {name:"Setrika - Express (24 jam)",price:3000,category:"Express (24 jam)"},
      {name:"Cuci + setrika - Express (24 jam)",price:7500,category:"Express (24 jam)"}
    ],
    item: [
      {name:"Sprei",price:15000},
      {name:"Selimut",price:20000},
      {name:"Tas",price:15000},
      {name:"Bedcover",price:25000},
      {name:"Jas",price:25000},
      {name:"Bantal",price:10000},
      {name:"Guling",price:10000},
      {name:"Boneka",price:15000}
    ]
  };
  let db = null, customers = [], orders = [], payments = [], orderItems = [], currentRole = null, currentUser = null, activeUserId = null;
  const configured = () => window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
    !window.SUPABASE_URL.includes("PASTE_") && !window.SUPABASE_ANON_KEY.includes("PASTE_");

  function toast(message, error=false) {
    const el = $("toast"); el.textContent = message; el.className = "toast show" + (error ? " error" : "");
    setTimeout(() => el.className = "toast", 3000);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function transactionId(order) { return order.id_transaksi || order.id_pesanan; }
  function orderGroups() {
    const groups=new Map();
    orders.forEach(order=>{
      const key=transactionId(order);
      if(!groups.has(key)) groups.set(key,{id:key,orders:[],first:order});
      groups.get(key).orders.push(order);
    });
    return [...groups.values()];
  }
  function paidForGroup(group) {
    const ids=new Set(group.orders.map(order=>order.id_pesanan));
    return payments.filter(payment=>ids.has(payment.id_pesanan)).reduce((sum,payment)=>sum+Number(payment.jumlah_bayar),0);
  }
  const accountNames={
    kas_tunai:"Kas Tunai",
    bank_qris:"Bank QRIS",
    pendapatan_jasa:"Pendapatan Jasa Laundry"
  };
  function accountingEntries() {
    const ordersById=new Map(orders.map(order=>[order.id_pesanan,order]));
    return payments.flatMap(payment=>{
      const order=ordersById.get(payment.id_pesanan);
      const method=String(payment.metode_pembayaran||"");
      const account=method.toLowerCase()==="tunai"?"kas_tunai":"bank_qris";
      const amount=Number(payment.jumlah_bayar)||0;
      const reference=String(payment.id_pembayaran||payment.id_pesanan||"").slice(0,8).toUpperCase();
      const description=`Penerimaan ${method} · ${customerName(order?.id_pelanggan)}`;
      const common={payment,date:String(payment.tanggal_pembayaran||""),reference,description,amount,createdAt:payment.created_at||""};
      return [
        {...common,id:`${payment.id_pembayaran}-debit`,account,debit:amount,credit:0,side:"debit"},
        {...common,id:`${payment.id_pembayaran}-credit`,account:"pendapatan_jasa",debit:0,credit:amount,side:"credit"}
      ];
    });
  }
  function entryDateTime(entry) {
    const date=entry.createdAt?new Date(entry.createdAt):new Date(`${entry.date}T00:00:00+07:00`);
    return Number.isNaN(date.getTime())?0:date.getTime();
  }
  function renderGeneralJournal() {
    const query=$("journal-search").value.trim().toLocaleLowerCase("id-ID");
    const entries=accountingEntries().sort((a,b)=>b.date.localeCompare(a.date)||entryDateTime(b)-entryDateTime(a)||String(a.payment.id_pembayaran).localeCompare(String(b.payment.id_pembayaran))||(a.side==="debit"?-1:1));
    const filtered=entries.filter(entry=>`${entry.date} ${entry.reference} ${entry.description} ${accountNames[entry.account]}`.toLocaleLowerCase("id-ID").includes(query));
    $("journal-count").textContent=`${new Set(filtered.map(entry=>entry.payment.id_pembayaran)).size} transaksi · ${filtered.length} baris jurnal`;
    $("general-journal-rows").innerHTML=filtered.map(entry=>`<tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.description)}</td><td>${escapeHtml(accountNames[entry.account])}</td><td>${entry.debit?money(entry.debit):"—"}</td><td>${entry.credit?money(entry.credit):"—"}</td></tr>`).join("")||blankRow(6,query?"Tidak ada jurnal yang cocok.":"Belum ada pembayaran untuk dijurnal.");
  }
  function renderGeneralLedger() {
    const account=$("ledger-account").value;
    const isRevenue=account==="pendapatan_jasa";
    const entries=accountingEntries().filter(entry=>entry.account===account)
      .sort((a,b)=>a.date.localeCompare(b.date)||entryDateTime(a)-entryDateTime(b)||a.side.localeCompare(b.side));
    let balance=0;
    const rows=entries.map(entry=>{
      balance+=isRevenue?entry.credit-entry.debit:entry.debit-entry.credit;
      return `<tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.description)}</td><td>${entry.debit?money(entry.debit):"—"}</td><td>${entry.credit?money(entry.credit):"—"}</td><td><b>${money(balance)}</b></td></tr>`;
    });
    $("ledger-summary").textContent=`${accountNames[account]} · ${entries.length} mutasi · Saldo ${isRevenue?"kredit":"debit"} ${money(balance)}`;
    $("general-ledger-rows").innerHTML=rows.join("")||blankRow(6,"Belum ada mutasi untuk akun ini.");
  }
  function paymentMatchesPeriod(payment,granularity,value) {
    if(granularity==="day") return /^\d{4}-\d{2}-\d{2}$/.test(value)&&payment.tanggal_pembayaran===value;
    if(granularity==="month") return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&String(payment.tanggal_pembayaran||"").startsWith(`${value}-`);
    return /^\d{4}$/.test(value)&&Number(value)>=2000&&Number(value)<=2100&&String(payment.tanggal_pembayaran||"").startsWith(`${value}-`);
  }
  function renderAccountingReports() {
    const {granularity,value}=selectedPeriod("accounting-report");
    const summary=periodSummary(granularity,value);
    const valid=granularity==="day"?/^\d{4}-\d{2}-\d{2}$/.test(value):granularity==="month"?/^\d{4}-(0[1-9]|1[0-2])$/.test(value):/^\d{4}$/.test(value)&&Number(value)>=2000&&Number(value)<=2100;
    const relevant=valid?payments.filter(payment=>paymentMatchesPeriod(payment,granularity,value)):[];
    const periodEnd=granularity==="day"?value:granularity==="month"?`${value}-31`:`${value}-12-31`;
    const balances=valid?payments.filter(payment=>/^\d{4}-\d{2}-\d{2}$/.test(String(payment.tanggal_pembayaran||""))&&payment.tanggal_pembayaran<=periodEnd):[];
    const amounts={pendapatan_jasa:0};
    relevant.forEach(payment=>{
      const amount=Number(payment.jumlah_bayar)||0,method=String(payment.metode_pembayaran||"").toLowerCase();
      amounts.pendapatan_jasa+=amount;
    });
    const accountBalances={kas_tunai:0,bank_qris:0,pendapatan_jasa:0};
    balances.forEach(payment=>{
      const amount=Number(payment.jumlah_bayar)||0,method=String(payment.metode_pembayaran||"").toLowerCase();
      const account=method==="tunai"?"kas_tunai":"bank_qris";
      accountBalances[account]+=amount;
      accountBalances.pendapatan_jasa+=amount;
    });
    const reportLabel=summary.label||"periode terpilih";
    $("accounting-report-period").textContent=`Periode ${reportLabel} · ${relevant.length} pembayaran · total pendapatan ${money(amounts.pendapatan_jasa)}.`;
    const accounts=[
      ["101","Kas Tunai",accountBalances.kas_tunai,0],
      ["102","Bank QRIS",accountBalances.bank_qris,0],
      ["401","Pendapatan Jasa Laundry",0,accountBalances.pendapatan_jasa]
    ];
    const debitTotal=accounts.reduce((total,account)=>total+account[2],0),creditTotal=accounts.reduce((total,account)=>total+account[3],0);
    $("trial-balance-rows").innerHTML=accounts.map(([code,name,debit,credit])=>`<tr><td>${code}</td><td>${name}</td><td>${money(debit)}</td><td>${money(credit)}</td></tr>`).join("");
    $("trial-balance-debit").textContent=money(debitTotal);
    $("trial-balance-credit").textContent=money(creditTotal);
    $("income-statement-rows").innerHTML=`<tr><th colspan="3">Pendapatan</th></tr><tr><td colspan="2">Pendapatan Jasa Laundry</td><td>${money(amounts.pendapatan_jasa)}</td></tr><tr><th colspan="2">Total pendapatan</th><th>${money(amounts.pendapatan_jasa)}</th></tr><tr><td colspan="2">Beban tercatat</td><td>${money(0)}</td></tr>`;
    $("net-income-total").textContent=money(amounts.pendapatan_jasa);
  }
  function incomeSummary() {
    const {year,month:monthPart}=wibParts(), month=Number(monthPart)-1, todayKey=dateKey();
    let todayTotal=0, monthTotal=0, todayCash=0, todayQris=0, monthCash=0, monthQris=0;
    payments.forEach(payment=>{
      const amount=Number(payment.jumlah_bayar)||0, paymentDate=String(payment.tanggal_pembayaran||"");
      const method=String(payment.metode_pembayaran||"").toLowerCase();
      const isCash=method==="tunai", isQris=method==="qris";
      if(paymentDate===todayKey) {
        todayTotal+=amount;
        if(isCash) todayCash+=amount;
        if(isQris) todayQris+=amount;
      }
      if(paymentDate.startsWith(`${year}-${monthPart}-`)) {
        monthTotal+=amount;
        if(isCash) monthCash+=amount;
        if(isQris) monthQris+=amount;
      }
    });
    return {todayTotal,monthTotal};
  }
  function monthLabel(year,month) {
    return new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric",timeZone:WIB}).format(new Date(Date.UTC(Number(year),month,1,12)));
  }
  function selectedPeriod(prefix) {
    const granularity=$(`${prefix}-granularity`).value;
    const value=granularity==="day"?$(`${prefix}-date`).value:granularity==="month"?$(`${prefix}-month-input`).value:$(`${prefix}-year-input`).value;
    return {granularity,value};
  }
  function configurePeriodControls(prefix) {
    const granularity=$(`${prefix}-granularity`).value;
    document.querySelectorAll(`[data-period-controls="${prefix}"] [data-period-input]`).forEach(label=>{
      label.hidden=label.dataset.periodInput!==granularity;
    });
  }
  function periodSummary(granularity,value) {
    const buckets=[];
    let label="",matches=payment=>false;
    if(granularity==="day") {
      label=value?new Date(`${value}T12:00:00+07:00`).toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:WIB}):"";
      matches=payment=>payment.tanggal_pembayaran===value;
      for(let hour=0;hour<24;hour++) buckets.push({key:String(hour).padStart(2,"0"),label:String(hour).padStart(2,"0")+":00",total:0,cash:0,qris:0,payments:0});
    } else if(granularity==="month") {
      const [year,month]=value.split("-").map(Number), monthTitle=monthLabel(year,month-1);
      label=monthTitle;
      const daysInMonth=new Date(Date.UTC(year,month,0)).getUTCDate();
      matches=payment=>String(payment.tanggal_pembayaran||"").startsWith(`${value}-`);
      for(let day=1;day<=daysInMonth;day++) {
        const date=new Date(Date.UTC(year,month-1,day,12));
        buckets.push({key:String(day).padStart(2,"0"),label:date.toLocaleDateString("id-ID",{day:"2-digit",month:"short",timeZone:WIB}),total:0,cash:0,qris:0,payments:0});
      }
    } else {
      label=`Tahun ${value}`;
      matches=payment=>String(payment.tanggal_pembayaran||"").startsWith(`${value}-`);
      for(let month=0;month<12;month++) buckets.push({key:String(month+1).padStart(2,"0"),label:new Date(Date.UTC(Number(value),month,1,12)).toLocaleDateString("id-ID",{month:"short",timeZone:WIB}),total:0,cash:0,qris:0,payments:0});
    }
    const summary={label,buckets,cash:0,qris:0,total:0,paymentCount:0,orderCount:0};
    const valid=granularity==="day"?/^\d{4}-\d{2}-\d{2}$/.test(value):granularity==="month"?/^\d{4}-(0[1-9]|1[0-2])$/.test(value):/^\d{4}$/.test(value)&&Number(value)>=2000&&Number(value)<=2100;
    if(!valid) return summary;
    const periodPayments=payments.filter(matches);
    const orderGroupByOrderId=new Map();
    orderGroups().forEach(group=>group.orders.forEach(order=>orderGroupByOrderId.set(order.id_pesanan,group.id)));
    const bucketOrderIds=buckets.map(()=>new Set());
    periodPayments.forEach(payment=>{
      const amount=Number(payment.jumlah_bayar)||0, method=String(payment.metode_pembayaran||"").toLowerCase();
      let index=0;
      if(granularity==="day") {
        const date=payment.created_at?new Date(payment.created_at):null;
        index=date&&!Number.isNaN(date.getTime())?Number(new Intl.DateTimeFormat("en-US",{hour:"2-digit",hourCycle:"h23",timeZone:WIB}).format(date)):0;
      } else if(granularity==="month") index=Number(String(payment.tanggal_pembayaran).slice(8,10))-1;
      else index=Number(String(payment.tanggal_pembayaran).slice(5,7))-1;
      const bucket=buckets[index];
      if(!bucket) return;
      bucket.total+=amount; bucket.payments++;
      summary.total+=amount; summary.paymentCount++;
      const groupId=orderGroupByOrderId.get(payment.id_pesanan);
      if(groupId!==undefined) bucketOrderIds[index].add(groupId);
      if(method==="tunai") {bucket.cash+=amount;summary.cash+=amount;}
      if(method==="qris") {bucket.qris+=amount;summary.qris+=amount;}
    });
    buckets.forEach((bucket,index)=>{bucket.orderCount=bucketOrderIds[index].size;});
    const paidOrderIds=new Set(periodPayments.map(payment=>payment.id_pesanan));
    summary.orderCount=orderGroups().filter(group=>group.orders.some(order=>paidOrderIds.has(order.id_pesanan))).length;
    return summary;
  }
  function initializePeriodControls() {
    const parts=wibParts(), currentDate=`${parts.year}-${parts.month}-${parts.day}`, currentMonth=`${parts.year}-${parts.month}`;
    [["dashboard-chart","month"],["report","month"],["accounting-report","month"]].forEach(([prefix,defaultGranularity])=>{
      $(`${prefix}-granularity`).value=defaultGranularity;
      $(`${prefix}-date`).value=currentDate;
      $(`${prefix}-month-input`).value=currentMonth;
      $(`${prefix}-year-input`).value=parts.year;
      configurePeriodControls(prefix);
    });
  }
  function renderDashboardDate() {
    const now=new Date(), dateElement=$("dashboard-date");
    dateElement.dateTime=dateKey(now);
    dateElement.textContent=new Intl.DateTimeFormat("id-ID",{
      weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:WIB
    }).format(now);
    $("dashboard-clock").textContent=new Intl.DateTimeFormat("id-ID",{
      hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23",timeZone:WIB
    }).format(now);
  }
  function customerName(id) { return customers.find(c=>c.id_pelanggan===id)?.nama_pelanggan || "Pelanggan dihapus"; }
  function blankRow(cols, msg="Belum ada data.") { return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`; }
  function setStatus(text, error=false) { $("connection-status").textContent=text; $("connection-status").style.color=error?"#a33c3c":"#168477"; }

  function separateOperationalPages() {
    $("work-queue-container").appendChild($("work-queue-panel"));
    $("customers-container").appendChild($("customer-list-panel"));
    $("orders-container").appendChild($("order-list-panel"));
    $("payments-container").appendChild($("payment-list-panel"));
  }

  async function fetchAllRows(createQuery) {
    const rows=[];
    const pageSize=1000;
    for(let offset=0;;offset+=pageSize) {
      const {data,error}=await createQuery().range(offset,offset+pageSize-1);
      if(error) return {data:null,error};
      rows.push(...(data||[]));
      if(!data||data.length<pageSize) return {data:rows,error:null};
    }
  }
  async function loadAll() {
    if (!db) return false;
    const [c,o,p] = await Promise.all([
      fetchAllRows(()=>db.from("pelanggan").select("*").order("nama_pelanggan").order("id_pelanggan")),
      fetchAllRows(()=>db.from("pesanan_laundry").select("*").order("created_at",{ascending:true}).order("id_pesanan")),
      fetchAllRows(()=>db.from("pembayaran").select("*").order("tanggal_pembayaran",{ascending:false}).order("id_pembayaran"))
    ]);
    const err = c.error || o.error || p.error;
    if (err) { setStatus("Gagal memuat data",true); toast(err.message,true); return false; }
    customers=c.data||[]; orders=o.data||[]; payments=p.data||[];
    renderAll();
    return true;
  }
  function renderAll() {
    renderCustomers(); renderOrders(); renderWorkQueue(); renderReadyPickup(); renderPayments(); renderSelectors(); renderDashboard(); renderReports(); renderGeneralJournal(); renderGeneralLedger(); renderAccountingReports();
  }
  function renderCustomers() {
    const q=($("customer-search")?.value||"").toLowerCase();
    const data=customers.filter(c=>`${c.nama_pelanggan} ${c.no_telepon||""} ${c.alamat||""}`.toLowerCase().includes(q));
    $("customer-count").textContent=`${customers.length} pelanggan`;
    $("customer-list").innerHTML=data.map(c=>`<tr><td><b>${escapeHtml(c.nama_pelanggan)}</b></td><td>${escapeHtml(c.no_telepon||"-")}</td><td>${currentRole==="owner"?`<button class="table-action" data-delete-customer="${c.id_pelanggan}">Hapus</button>`:"—"}</td></tr>`).join("")||blankRow(3);
  }
  function renderOrders() {
    const q=($("order-search")?.value||"").toLowerCase();
    const data=orderGroups().filter(group=>`${customerName(group.first.id_pelanggan)} ${group.orders.map(order=>order.jenis_layanan).join(" ")}`.toLowerCase().includes(q))
      .sort((a,b)=>new Date(b.first.created_at||b.first.tanggal_pesanan)-new Date(a.first.created_at||a.first.tanggal_pesanan));
    $("order-list").innerHTML=data.map(group=>{
      const first=group.first;
      const details=group.orders.map(order=>`${escapeHtml(order.jenis_layanan)} (${Number(order.berat_kg).toLocaleString("id-ID")} ${escapeHtml(order.satuan||"kg")})`).join("<br>");
      return `<tr><td>${escapeHtml(first.tanggal_pesanan)}</td><td>${escapeHtml(customerName(first.id_pelanggan))}</td><td>${details}</td><td>${group.orders.length} layanan</td><td><b>${money(paidForGroup(group))}</b></td></tr>`;
    }).join("")||blankRow(5);
  }
  function renderWorkQueue() {
    const groupsByDay=new Map();
    orderGroups().forEach(group=>{
      const day=String(group.first.tanggal_pesanan||"").slice(0,10)||"Tanggal tidak diketahui";
      if(!groupsByDay.has(day)) groupsByDay.set(day,[]);
      groupsByDay.get(day).push(group);
    });
    let totalPending=0,totalCompleted=0;
    const dayRows=[...groupsByDay.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([day,groups])=>{
      groups.sort((a,b)=>new Date(a.first.created_at||a.first.tanggal_pesanan)-new Date(b.first.created_at||b.first.tanggal_pesanan));
      const completed=groups.filter(group=>group.orders.every(order=>order.selesai)).length;
      totalPending+=groups.length-completed;
      totalCompleted+=completed;
      const dayLabel=day==="Tanggal tidak diketahui"?day:new Date(`${day}T12:00:00+07:00`).toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:WIB});
      const heading=`<tr class="work-day-divider"><th colspan="6"><span>${escapeHtml(dayLabel)}</span><span>${groups.length} pesanan · ${groups.length-completed} belum selesai · ${completed} selesai</span></th></tr>`;
      const rows=groups.map((group,index)=>{
        const first=group.first, isCompleted=group.orders.every(order=>order.selesai);
        const timestamp=first.created_at?new Date(first.created_at):new Date(`${first.tanggal_pesanan}T00:00:00`);
        const receivedAt=timestamp.toLocaleString("id-ID",{timeZone:WIB,day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
        const services=group.orders.map(order=>`${escapeHtml(order.jenis_layanan)} (${Number(order.berat_kg).toLocaleString("id-ID")} ${escapeHtml(order.satuan||"kg")})`).join("<br>");
        const total=group.orders.reduce((sum,order)=>sum+Number(order.total_tagihan),0);
        return `<tr class="${isCompleted?"work-completed":""}"><td><b>#${index+1}</b></td><td>${escapeHtml(receivedAt)}</td><td><b>${escapeHtml(customerName(first.id_pelanggan))}</b></td><td>${services}</td><td>${money(total)}</td><td><label class="completion-control"><input type="checkbox" data-complete-order="${escapeHtml(group.id)}" ${isCompleted?"checked":""}><span>${isCompleted?"Selesai":"Tandai selesai"}</span></label></td></tr>`;
      }).join("");
      return heading+rows;
    });
    $("work-queue-count").textContent=`${totalPending} belum selesai · ${totalCompleted} selesai · antrean dipisah berdasarkan tanggal pesanan`;
    $("work-queue").innerHTML=dayRows.join("")||blankRow(6,"Belum ada pesanan di antrean.");
  }
  function renderReadyPickup() {
    const query=$("ready-pickup-search").value.trim().toLocaleLowerCase("id-ID");
    const selectedDate=$("ready-pickup-date").value;
    const completed=orderGroups().filter(group=>group.orders.every(order=>order.selesai))
      .sort((a,b)=>new Date(b.first.created_at||b.first.tanggal_pesanan)-new Date(a.first.created_at||a.first.tanggal_pesanan));
    const visible=completed.filter(group=>
      customerName(group.first.id_pelanggan).toLocaleLowerCase("id-ID").includes(query)&&
      (!selectedDate||String(group.first.tanggal_pesanan||"").slice(0,10)===selectedDate)
    );
    const pickedUp=visible.filter(group=>group.orders.every(order=>order.diambil)).length;
    const readyCount=visible.length-pickedUp;
    $("ready-pickup-count").textContent=`${readyCount} siap diambil · ${pickedUp} sudah diambil${query||selectedDate?` · ${visible.length} hasil filter`:""}`;
    const groupsByDay=new Map();
    visible.forEach(group=>{
      const day=String(group.first.tanggal_pesanan||"").slice(0,10)||"Tanggal tidak diketahui";
      if(!groupsByDay.has(day)) groupsByDay.set(day,[]);
      groupsByDay.get(day).push(group);
    });
    const dayRows=[...groupsByDay.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([day,groups])=>{
      const dayLabel=day==="Tanggal tidak diketahui"?day:new Date(`${day}T12:00:00+07:00`).toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric",timeZone:WIB});
      const dayPickedUp=groups.filter(group=>group.orders.every(order=>order.diambil)).length;
      const heading=`<tr class="work-day-divider"><th colspan="5"><span>${escapeHtml(dayLabel)}</span><span>${groups.length} pesanan · ${groups.length-dayPickedUp} siap diambil · ${dayPickedUp} sudah diambil</span></th></tr>`;
      const rows=groups.map(group=>{
      const first=group.first, isPickedUp=group.orders.every(order=>order.diambil);
      const services=group.orders.map(order=>`${escapeHtml(order.jenis_layanan)} (${Number(order.berat_kg).toLocaleString("id-ID")} ${escapeHtml(order.satuan||"kg")})`).join("<br>");
      const total=group.orders.reduce((sum,order)=>sum+Number(order.total_tagihan),0);
      return `<tr class="${isPickedUp?"work-completed":""}"><td>${escapeHtml(first.tanggal_pesanan)}</td><td><b>${escapeHtml(customerName(first.id_pelanggan))}</b></td><td>${services}</td><td><b>${money(total)}</b></td><td><label class="completion-control"><input type="checkbox" data-pickup-order="${escapeHtml(group.id)}" ${isPickedUp?"checked":""}><span>${isPickedUp?"Sudah diambil":"Tandai diambil"}</span></label></td></tr>`;
      }).join("");
      return heading+rows;
    });
    $("ready-pickup-list").innerHTML=dayRows.join("")||blankRow(5,query||selectedDate?"Tidak ada pesanan yang cocok dengan filter.":"Belum ada laundry selesai yang siap diambil.");
  }
  function renderPayments() {
    const method=$("payment-method-filter").value;
    const filtered=payments.filter(payment=>!method||payment.metode_pembayaran===method);
    $("payment-count").textContent=`${filtered.length} dari ${payments.length} pembayaran`;
    $("payment-list").innerHTML=filtered.map(p=>`<tr><td>${escapeHtml(p.tanggal_pembayaran)}</td><td>${escapeHtml(customerName(orders.find(o=>o.id_pesanan===p.id_pesanan)?.id_pelanggan))}</td><td>${escapeHtml(String(p.id_pesanan).slice(0,8))}</td><td>${escapeHtml(p.metode_pembayaran)}</td><td><b>${money(p.jumlah_bayar)}</b></td></tr>`).join("")||blankRow(5,method?`Belum ada pembayaran dengan metode ${escapeHtml(method)}.`:"Belum ada data pembayaran.");
  }
  function renderSelectors() {
    const customerSelect=$("order-customer");
    const selectedValue=customerSelect.value;
    customerSelect.innerHTML='<option value="">Pilih pelanggan</option><option value="__new__">+ Daftarkan pelanggan baru</option>'+customers.map(c=>`<option value="${c.id_pelanggan}">${escapeHtml(c.nama_pelanggan)}</option>`).join("");
    if([...customerSelect.options].some(option=>option.value===selectedValue)) customerSelect.value=selectedValue;
    updateCustomerPicker();
  }
  function updateCustomerPicker() {
    const query=$("customer-picker-search").value.trim().toLocaleLowerCase("id-ID");
    const customerSelect=$("order-customer");
    const results=customers.filter(customer=>customer.nama_pelanggan.toLocaleLowerCase("id-ID").includes(query));
    $("customer-picker-options").innerHTML=
      `<button class="customer-picker-register" type="button" role="option" data-customer-choice="__new__">+ Daftarkan pelanggan baru</button>`+
      (results.length?results.map(customer=>`<button class="customer-picker-option" type="button" role="option" aria-selected="${customerSelect.value===customer.id_pelanggan}" data-customer-choice="${customer.id_pelanggan}"><span>${escapeHtml(customer.nama_pelanggan)}</span><small>${escapeHtml(customer.no_telepon||"Tanpa nomor telepon")}</small></button>`).join(""):`<p class="customer-picker-empty">Pelanggan tidak ditemukan.</p>`);
  }
  function openCustomerPicker() {
    updateCustomerPicker();
    $("customer-picker-options").hidden=false;
    $("customer-picker-search").setAttribute("aria-expanded","true");
  }
  function closeCustomerPicker() {
    $("customer-picker-options").hidden=true;
    $("customer-picker-search").setAttribute("aria-expanded","false");
  }
  function chooseCustomer(value) {
    const customerSelect=$("order-customer");
    customerSelect.value=value;
    $("customer-picker-search").value=value==="__new__"?"Daftarkan pelanggan baru":customers.find(customer=>customer.id_pelanggan===value)?.nama_pelanggan||"";
    toggleNewCustomerFields();
    closeCustomerPicker();
  }
  function toggleNewCustomerFields() {
    const isNew=$("order-customer").value==="__new__";
    const fields=$("new-customer-fields");
    fields.hidden=!isNew;
    $("customer-name").required=isNew;
  }
  function renderPriceList() {
    $("price-list-grid").innerHTML=`
      <div><h4>Layanan kiloan · Reguler (2 hari)</h4>${serviceCatalog.kg.filter(service=>service.category==="Reguler (2 hari)").map(service=>`<p>${escapeHtml(service.name.split(" - ")[0])} <strong>${money(service.price)}/kg</strong></p>`).join("")}</div>
      <div><h4>Layanan kiloan · Express (24 jam)</h4>${serviceCatalog.kg.filter(service=>service.category==="Express (24 jam)").map(service=>`<p>${escapeHtml(service.name.split(" - ")[0])} <strong>${money(service.price)}/kg</strong></p>`).join("")}</div>
      <div><h4>Layanan satuan</h4>${serviceCatalog.item.map(service=>`<p>${escapeHtml(service.name)} <strong>${money(service.price)}/item</strong></p>`).join("")}</div>`;
  }
  function populateServices() {
    const unit=$("order-category").value, services=serviceCatalog[unit];
    if(unit==="kg") {
      $("order-service").innerHTML=["Reguler (2 hari)","Express (24 jam)"].map(category=>`<optgroup label="${category}">${services.filter(service=>service.category===category).map(service=>`<option value="${escapeHtml(service.name)}" data-unit="${unit}" data-price="${service.price}">${escapeHtml(service.name.split(" - ")[0])} — ${money(service.price)}/kg</option>`).join("")}</optgroup>`).join("");
    } else {
      $("order-service").innerHTML=services.map(service=>`<option value="${escapeHtml(service.name)}" data-unit="${unit}" data-price="${service.price}">${escapeHtml(service.name)} — ${money(service.price)}/item</option>`).join("");
    }
    updateServiceDetails();
  }
  function renderOrderItems() {
    $("order-items").innerHTML=orderItems.map((item,index)=>`<tr><td>${escapeHtml(item.name)}</td><td>${Number(item.quantity).toLocaleString("id-ID")} ${escapeHtml(item.unit)}</td><td>${money(item.unit_price)}</td><td><b>${money(item.quantity*item.unit_price)}</b></td><td><button class="table-action" type="button" data-remove-order-item="${index}">Hapus</button></td></tr>`).join("")||blankRow(5,"Tambahkan layanan untuk mulai membuat pesanan.");
    const total=orderItems.reduce((sum,item)=>sum+item.quantity*item.unit_price,0);
    $("order-item-count").textContent=orderItems.length?`${orderItems.length} layanan ditambahkan`:"Belum ada layanan ditambahkan.";
    $("order-total-preview").textContent=money(total);
  }
  function addOrderItem() {
    const quantity=Number($("order-weight").value), unitPrice=Number($("order-price").value);
    const option=$("order-service").selectedOptions[0],unit=option.dataset.unit;
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unitPrice)||unitPrice<=0) return toast("Masukkan jumlah dan harga layanan yang valid.",true);
    if(unit==="item"&&!Number.isInteger(quantity)) return toast("Jumlah layanan satuan harus berupa bilangan bulat.",true);
    if(unit==="kg"&&Number(quantity.toFixed(2))!==quantity) return toast("Berat kiloan maksimal dua angka di belakang koma.",true);
    orderItems.push({name:option.value,unit,quantity,unit_price:unitPrice});
    renderOrderItems();
    $("order-weight").value="";
    $("item-total-preview").textContent=money(0);
  }
  function renderDashboard() {
    const income=incomeSummary();
    const groups=orderGroups();
    $("stat-orders").textContent=groups.length;
    $("stat-today-income").textContent=money(income.todayTotal);
    $("stat-month-income").textContent=money(income.monthTotal);
    const period=selectedPeriod("dashboard-chart");
    renderIncomeChart(periodSummary(period.granularity,period.value));
    $("recent-orders").innerHTML=groups.slice(0,6).map(group=>{
      const first=group.first;
      const details=group.orders.map(order=>`${escapeHtml(order.jenis_layanan)} (${Number(order.berat_kg).toLocaleString("id-ID")} ${escapeHtml(order.satuan||"kg")})`).join("<br>");
      return `<tr><td>${escapeHtml(first.tanggal_pesanan)}</td><td>${escapeHtml(customerName(first.id_pelanggan))}</td><td>${details}</td><td>${group.orders.length} layanan</td><td><b>${money(paidForGroup(group))}</b></td></tr>`;
    }).join("")||blankRow(5);
  }
  function renderReports() {
    const period=selectedPeriod("report");
    const income=periodSummary(period.granularity,period.value);
    $("report-period-label").textContent=`Pendapatan berdasarkan tanggal pembayaran · ${income.label}.`;
    $("report-cash-total").textContent=money(income.cash);
    $("report-qris-total").textContent=money(income.qris);
    $("report-total").textContent=money(income.total);
    $("report-cash-caption").textContent=`Tunai · ${income.label}`;
    $("report-qris-caption").textContent=`QRIS · ${income.label}`;
    $("report-payment-count").textContent=`${income.paymentCount} pembayaran`;
    $("report-order-count").textContent=`${income.orderCount} pesanan dengan pembayaran pada periode terpilih`;
    $("daily-income-report").innerHTML=income.buckets.map(item=>`<tr><td>${escapeHtml(item.label)}</td><td>${money(item.cash)}</td><td>${money(item.qris)}</td><td><b>${money(item.total)}</b></td></tr>`).join("")||blankRow(4);
  }
  function renderIncomeChart(income) {
    const svg=$("income-chart");
    const period=selectedPeriod("dashboard-chart");
    const granularityLabel=period.granularity==="day"?"per jam":period.granularity==="month"?"per hari":"per bulan";
    $("dashboard-chart-period-label").textContent=`Pendapatan ${granularityLabel} · ${income.label}`;
    svg.setAttribute("aria-label",`Grafik pendapatan ${granularityLabel} · ${income.label}`);
    const left=86,right=18,top=22,bottom=48,width=1000-left-right,height=340-top-bottom;
    const maxIncome=Math.max(...income.buckets.map(item=>item.total),0), axisMax=maxIncome?Math.ceil(maxIncome/4)*4:0;
    const slotWidth=width/income.buckets.length, barWidth=Math.max(3,Math.min(24,slotWidth*0.68));
    const grid=Array.from({length:5},(_,index)=>{
      const value=axisMax*(4-index)/4, y=top+height*index/4;
      return `<line x1="${left}" y1="${y}" x2="${1000-right}" y2="${y}" class="chart-grid"/><text x="${left-10}" y="${y+4}" text-anchor="end" class="chart-axis-label">${escapeHtml(compactMoney(value))}</text>`;
    }).join("");
    const labelEvery=income.buckets.length>18?Math.ceil(income.buckets.length/12):1;
    const bars=income.buckets.map((item,index)=>{
      const x=left+slotWidth*(index+0.5)-barWidth/2;
      const barHeight=item.total&&axisMax?Math.max(2,item.total/axisMax*height):0;
      const y=top+height-barHeight;
      const tick=index%labelEvery===0||index===income.buckets.length-1?`<text x="${left+slotWidth*(index+0.5)}" y="${top+height+24}" text-anchor="middle" class="chart-day-label">${escapeHtml(item.label)}</text>`:"";
      return `<g class="chart-point" data-label="${escapeHtml(item.label)}" data-total="${item.total}" data-orders="${item.orderCount||0}"><rect x="${x}" y="${top}" width="${slotWidth}" height="${height}" fill="transparent" class="chart-hit-area"/><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" class="chart-bar" style="--bar-index:${index}"/>${tick}</g>`;
    }).join("");
    svg.innerHTML=`${grid}<line x1="${left}" y1="${top+height}" x2="${1000-right}" y2="${top+height}" class="chart-baseline"/>${bars}`;
  }
  function compactMoney(value) {
    return `Rp${new Intl.NumberFormat("id-ID",{notation:"compact",maximumFractionDigits:1}).format(value)}`;
  }
  function updateIncomeChartTooltip(event) {
    const tooltip=$("income-chart-tooltip"),wrap=$("income-chart-wrap");
    const point=event.target.closest(".chart-point");
    if(!point) return;
    const orderCount=Number(point.dataset.orders)||0;
    tooltip.innerHTML=`<strong>${escapeHtml(point.dataset.label)}</strong><span>Pendapatan <b>${money(Number(point.dataset.total)||0)}</b></span><span>${orderCount} pesanan</span>`;
    tooltip.classList.add("visible");
    tooltip.setAttribute("aria-hidden","false");
    const bounds=wrap.getBoundingClientRect(),contentX=event.clientX-bounds.left+wrap.scrollLeft;
    const tooltipWidth=tooltip.offsetWidth,tooltipHeight=tooltip.offsetHeight;
    const minX=wrap.scrollLeft+6,maxX=wrap.scrollLeft+wrap.clientWidth-tooltipWidth-6;
    tooltip.style.left=`${Math.max(minX,Math.min(contentX,maxX))}px`;
    const cursorY=event.clientY-bounds.top+wrap.scrollTop;
    const showBelow=cursorY<tooltipHeight+18;
    tooltip.style.top=`${cursorY}px`;
    tooltip.style.transform=showBelow?"translate(-50%, 12px)":"translate(-50%, calc(-100% - 12px))";
  }
  function hideIncomeChartTooltip() {
    const tooltip=$("income-chart-tooltip");
    tooltip.classList.remove("visible");
    tooltip.setAttribute("aria-hidden","true");
  }
  async function addOrder(e) {
    e.preventDefault();
    if(!$("order-customer").value) {
      toast("Pilih pelanggan atau daftarkan pelanggan baru.",true);
      $("customer-picker-search").focus();
      openCustomerPicker();
      return;
    }
    if(!orderItems.length) return toast("Tambahkan minimal satu layanan ke pesanan.",true);
    const orderDate=today();
    let customerId=$("order-customer").value;
    const isNewCustomer=customerId==="__new__";
    if(isNewCustomer) {
      const customer={nama_pelanggan:$("customer-name").value.trim(),no_telepon:$("customer-phone").value.trim()||null};
      const {data,error}=await db.from("pelanggan").insert(customer).select("id_pelanggan").single();
      if(error) return toast(error.message,true);
      customerId=data.id_pelanggan;
    }
    const {error}=await db.rpc("buat_pesanan_laundry",{
      p_customer_id:customerId,
      p_date:orderDate,
      p_payment_date:orderDate,
      p_payment_method:$("order-payment-method").value,
      p_items:orderItems
    });
    if(error) {
      if(isNewCustomer) {
        await loadAll();
        return toast(`Pelanggan berhasil didaftarkan, tetapi pesanan gagal disimpan: ${error.message}`,true);
      }
      return toast(error.message,true);
    }
    e.target.reset(); $("customer-picker-search").value=""; closeCustomerPicker(); orderItems=[]; toggleNewCustomerFields(); populateServices(); renderOrderItems();
    if(await loadAll()) toast("Pesanan dan pembayaran berhasil dicatat.");
  }
  async function deleteCustomer(id) {
    if(orders.some(o=>o.id_pelanggan===id)) return toast("Pelanggan memiliki riwayat pesanan dan tidak dapat dihapus.",true);
    if(!confirm("Hapus data pelanggan ini?")) return;
    const {error}=await db.from("pelanggan").delete().eq("id_pelanggan",id); if(error) return toast(error.message,true);
    if(await loadAll()) toast("Pelanggan dihapus.");
  }
  async function setOrderCompletion(transactionId, isCompleted, checkbox) {
    const group=orderGroups().find(item=>item.id===transactionId);
    if(!group) return;
    checkbox.disabled=true;
    const ids=group.orders.map(order=>order.id_pesanan);
    const {error}=await db.from("pesanan_laundry").update({selesai:isCompleted,...(isCompleted?{}:{diambil:false})}).in("id_pesanan",ids);
    if(error) {
      toast(error.message,true);
      renderWorkQueue();
      return;
    }
    if(await loadAll()) toast(isCompleted?"Pesanan ditandai selesai.":"Pesanan dikembalikan ke antrean.");
    else renderWorkQueue();
  }
  async function setOrderPickup(transactionId,isPickedUp,checkbox) {
    const group=orderGroups().find(item=>item.id===transactionId);
    if(!group||!group.orders.every(order=>order.selesai)) return;
    checkbox.disabled=true;
    const ids=group.orders.map(order=>order.id_pesanan);
    const {error}=await db.from("pesanan_laundry").update({diambil:isPickedUp}).in("id_pesanan",ids);
    if(error) {
      toast(error.message,true);
      renderReadyPickup();
      return;
    }
    if(await loadAll()) toast(isPickedUp?"Pesanan ditandai sudah diambil.":"Status pengambilan dibatalkan.");
    else renderReadyPickup();
  }
  function updateServiceDetails() {
    const option=$("order-service").selectedOptions[0];
    if(!option) return;
    const unit=option.dataset.unit, isItem=unit==="item";
    $("order-quantity-label").textContent=isItem?"Jumlah (item)":"Berat (kg)";
    $("order-price-label").textContent=isItem?"Harga per item (Rp)":"Harga per kg (Rp)";
    $("order-weight").min=isItem?"1":"0.1";
    $("order-weight").step=isItem?"1":"0.1";
    $("order-weight").placeholder=isItem?"Contoh: 2":"Contoh: 4.5";
    $("order-weight").value="";
    $("order-price").value=option.dataset.price;
    $("order-price").step="1";
    updateTotalPreview();
  }
  function updateTotalPreview() { $("item-total-preview").textContent=money(Number($("order-weight").value)*Number($("order-price").value)); }
  function exportCsv() {
    const rows=[["Tanggal","Pelanggan","Layanan","Jumlah baris layanan","Total dibayar"],...orderGroups().map(group=>{
      const first=group.first,total=group.orders.reduce((sum,order)=>sum+Number(order.total_tagihan),0);
      const details=group.orders.map(order=>`${order.jenis_layanan}: ${order.berat_kg} ${order.satuan||"kg"} x ${order.harga_per_kg}`).join("; ");
      return [first.tanggal_pesanan,customerName(first.id_pelanggan),details,group.orders.length,total];
    })];
    const csv=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const url=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"})), a=document.createElement("a");
    a.href=url; a.download="laporan-pesanan-laundry.csv"; a.click(); URL.revokeObjectURL(url);
  }
  function navigate(page) {
    if(currentRole!=="owner"&&["general-journal","general-ledger","accounting-reports","reports","staff-account-page"].includes(page)) {
      toast("Halaman ini hanya dapat diakses pemilik.",true);
      return;
    }
    document.querySelectorAll(".page").forEach(el=>el.classList.toggle("active",el.id===page));
    document.querySelectorAll(".nav-btn").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
    const titles={
      dashboard:"Dashboard",
      "order-entry":"Pesanan Laundry",
      "work-queue-page":"Antrean Pengerjaan",
      "ready-pickup-page":"Laundry Siap Ambil",
      "customers-page":"Daftar Pelanggan",
      "orders-page":"Daftar Pesanan",
      "payments-page":"Riwayat Pembayaran",
      "general-journal":"Jurnal Umum",
      "general-ledger":"Buku Besar",
      "accounting-reports":"Laporan Akuntansi",
      reports:"Laporan Pendapatan",
      "staff-account-page":"Akun Pegawai"
    };
    $("page-title").textContent=titles[page]||"Dashboard";
    $("profile-menu").open=false;
  }
  function setSidebarOpen(isOpen,returnFocus=false) {
    const sidebar=$("sidebar"), toggle=$("sidebar-toggle");
    sidebar.classList.toggle("open",isOpen);
    sidebar.setAttribute("aria-hidden",String(!isOpen));
    $("sidebar-backdrop").classList.toggle("visible",isOpen);
    toggle.setAttribute("aria-expanded",String(isOpen));
    document.body.classList.toggle("sidebar-open",isOpen);
    if(isOpen) {
      setTimeout(()=>{
        if(sidebar.classList.contains("open")) $("sidebar-close").focus();
      },300);
    }
    else if(returnFocus) toggle.focus();
  }
  let sidebarDragStart=null;
  $("sidebar-toggle").addEventListener("click",()=>setSidebarOpen(true));
  $("sidebar-close").addEventListener("click",()=>setSidebarOpen(false,true));
  $("sidebar-backdrop").addEventListener("click",()=>setSidebarOpen(false));
  $("sidebar").addEventListener("pointerdown",event=>{
    if(event.pointerType==="mouse"&&event.button!==0) return;
    sidebarDragStart={x:event.clientX,y:event.clientY};
  });
  document.addEventListener("pointerup",event=>{
    if(!sidebarDragStart) return;
    const deltaX=event.clientX-sidebarDragStart.x, deltaY=Math.abs(event.clientY-sidebarDragStart.y);
    sidebarDragStart=null;
    if(deltaX < -70&&Math.abs(deltaX)>deltaY) setSidebarOpen(false);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&$("sidebar").classList.contains("open")) setSidebarOpen(false,true);
  });
  document.addEventListener("click",e=>{
    const customerChoice=e.target.closest("[data-customer-choice]");
    if(customerChoice) {chooseCustomer(customerChoice.dataset.customerChoice);return;}
    if(!e.target.closest("#customer-picker")) closeCustomerPicker();
    const nav=e.target.closest("[data-page]"); if(nav) {navigate(nav.dataset.page);setSidebarOpen(false);}
    const go=e.target.closest("[data-goto]"); if(go) navigate(go.dataset.goto==="operations"?"order-entry":go.dataset.goto);
    const del=e.target.closest("[data-delete-customer]"); if(del) deleteCustomer(del.dataset.deleteCustomer);
    const removeItem=e.target.closest("[data-remove-order-item]"); if(removeItem) {orderItems.splice(Number(removeItem.dataset.removeOrderItem),1);renderOrderItems();}
  });
  document.addEventListener("change",e=>{
    const completion=e.target.closest("[data-complete-order]");
    if(completion) setOrderCompletion(completion.dataset.completeOrder,completion.checked,completion);
    const pickup=e.target.closest("[data-pickup-order]");
    if(pickup) setOrderPickup(pickup.dataset.pickupOrder,pickup.checked,pickup);
  });
  $("order-form").addEventListener("submit",addOrder);
  $("customer-picker-search").addEventListener("focus",openCustomerPicker);
  $("customer-picker-search").addEventListener("input",()=>{
    $("order-customer").value="";
    toggleNewCustomerFields();
    openCustomerPicker();
  });
  $("customer-picker-search").addEventListener("keydown",event=>{
    if(event.key==="Escape") closeCustomerPicker();
    if(event.key==="ArrowDown") {
      event.preventDefault();
      $("customer-picker-options").querySelector("[data-customer-choice]")?.focus();
    }
  });
  $("customer-picker-options").addEventListener("keydown",event=>{
    if(event.key==="Escape") {
      closeCustomerPicker();
      $("customer-picker-search").focus();
    }
  });
  $("add-order-item").addEventListener("click",addOrderItem);
  $("customer-search").addEventListener("input",renderCustomers); $("order-search").addEventListener("input",renderOrders);
  $("journal-search").addEventListener("input",renderGeneralJournal);
  $("ready-pickup-search").addEventListener("input",renderReadyPickup);
  $("ready-pickup-date").addEventListener("change",renderReadyPickup);
  $("ledger-account").addEventListener("change",renderGeneralLedger);
  $("payment-method-filter").addEventListener("change",renderPayments);
  $("income-chart").addEventListener("pointerover",updateIncomeChartTooltip);
  $("income-chart").addEventListener("pointermove",updateIncomeChartTooltip);
  $("income-chart").addEventListener("pointerleave",hideIncomeChartTooltip);
  $("order-category").addEventListener("change",populateServices);
  $("order-service").addEventListener("change",updateServiceDetails);
  $("order-weight").addEventListener("input",updateTotalPreview); $("order-price").addEventListener("input",updateTotalPreview);
  ["dashboard-chart","report","accounting-report"].forEach(prefix=>{
    const controls=document.querySelector(`[data-period-controls="${prefix}"]`);
    controls.addEventListener("change",event=>{
      if(event.target.id===`${prefix}-granularity`) configurePeriodControls(prefix);
      if(prefix==="dashboard-chart") renderDashboard();
      else if(prefix==="report") renderReports();
      else renderAccountingReports();
    });
  });
  $("export-csv").addEventListener("click",exportCsv);
  $("login-form").addEventListener("submit",async event=>{
    event.preventDefault();
    const submit=$("login-submit"),errorBox=$("login-error");
    errorBox.hidden=true;
    if(!db) {
      errorBox.textContent="Koneksi autentikasi belum siap. Periksa konfigurasi Supabase.";
      errorBox.hidden=false;
      return;
    }
    submit.disabled=true;
    submit.textContent="Memeriksa...";
    const username=$("login-username").value.trim().normalize("NFKC").toLocaleLowerCase("id-ID");
    const loginAliases=new Map([
      ["desta bagaskara","desta@laundry.com"],
      ["desta","desta@laundry.com"],
      ["karyawan","karyawan@laundry.com"],
      ["kasir","karyawan@laundry.com"]
    ]);
    const email=loginAliases.get(username)||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)?username:null);
    if(!email) {
      errorBox.textContent="Username tidak dikenal.";
      errorBox.hidden=false;
      submit.disabled=false;
      submit.textContent="Masuk";
      return;
    }
    try {
      const {error}=await db.auth.signInWithPassword({email,password:$("login-password").value});
      if(error) {
        errorBox.textContent="Username/email atau kata sandi tidak sesuai.";
        errorBox.hidden=false;
      }
    } catch(error) {
      errorBox.textContent=`Login gagal: ${error.message||error}`;
      errorBox.hidden=false;
    } finally {
      submit.disabled=false;
      submit.textContent="Masuk";
    }
  });
  $("toggle-password-visibility").addEventListener("click",()=>{
    const input=$("login-password"), button=$("toggle-password-visibility");
    const reveal=input.type==="password";
    input.type=reveal?"text":"password";
    button.setAttribute("aria-pressed",String(reveal));
    button.setAttribute("aria-label",reveal?"Sembunyikan kata sandi":"Tampilkan kata sandi");
  });
  $("logout-button").addEventListener("click",async()=>{
    $("profile-menu").open=false;
    const {error}=await db.auth.signOut();
    if(error) toast(`Gagal keluar: ${error.message}`,true);
  });
  document.addEventListener("click",event=>{
    const profileMenu=$("profile-menu");
    if(profileMenu.open&&!profileMenu.contains(event.target)) profileMenu.open=false;
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&$("profile-menu").open) {
      $("profile-menu").open=false;
      $("profile-menu").querySelector("summary").focus();
    }
  });
  $("cashier-account-form").addEventListener("submit",async event=>{
    event.preventDefault();
    if($("cashier-password").value!==$("cashier-password-confirm").value) {
      toast("Konfirmasi kata sandi belum sama.",true);
      $("cashier-password-confirm").focus();
      return;
    }
    const button=$("cashier-account-submit");
    button.disabled=true;
    try {
      const {data,error}=await db.functions.invoke("manage-cashier",{body:{password:$("cashier-password").value}});
      if(error) return toast(`Akun kasir gagal disimpan: ${error.message}`,true);
      if(data?.error) return toast(`Akun kasir gagal disimpan: ${data.error}`,true);
      $("cashier-account-form").reset();
      toast("Akun kasir bersama berhasil dibuat atau diperbarui.");
    } catch(error) {
      toast(`Akun kasir gagal disimpan: ${error.message||error}`,true);
    } finally {
      button.disabled=false;
    }
  });
  separateOperationalPages(); initializePeriodControls(); renderDashboardDate(); toggleNewCustomerFields(); populateServices(); renderPriceList(); renderOrderItems();
  setInterval(()=>{
    const previousDate=$("dashboard-date").dateTime;
    renderDashboardDate();
    if($("dashboard-date").dateTime!==previousDate) { renderDashboard(); renderReports(); }
  },1000);
  if(!configured()) { setStatus("Konfigurasi diperlukan",true); toast("Isi URL dan key Supabase di frontend/JS/config.js.",true); return; }
  if(!window.supabase) { setStatus("Library Supabase gagal dimuat",true); return; }
  db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  function applyRole() {
    document.querySelectorAll("[data-owner-only]").forEach(element=>{
      element.hidden=currentRole!=="owner";
    });
    const name=currentRole==="owner"?"Desta Bagaskara":"Karyawan";
    const role=currentRole==="owner"?"Pemilik":"Pegawai";
    $("dashboard-welcome").textContent=`Selamat datang, ${name}!`;
    $("signed-in-label").textContent=`${role} · ${name}`;
    $("sidebar-profile-name").textContent=name;
    $("sidebar-profile-role").textContent=role;
    $("profile-menu").hidden=false;
  }
  async function activateSession(session) {
    if(!session?.user||activeUserId===session.user.id) return;
    activeUserId=session.user.id;
    currentUser=session.user;
    const {data,error}=await db.from("app_user_roles").select("role").eq("user_id",session.user.id).single();
    if(error||!["owner","cashier"].includes(data?.role)) {
      activeUserId=null; currentUser=null; currentRole=null;
      await db.auth.signOut();
      $("login-error").textContent=error?.code==="PGRST116"?"Akun belum memiliki hak akses. Hubungi pemilik.":"Hak akses tidak dapat diverifikasi. Periksa skema Supabase.";
      $("login-error").hidden=false;
      return;
    }
    currentRole=data.role;
    applyRole();
    document.body.classList.remove("auth-required");
    $("auth-screen").hidden=true;
    $("login-password").value="";
    setStatus("Memuat data...");
    if(await loadAll()) setStatus("Terhubung ke Supabase");
  }
  function showLogin() {
    currentRole=null; currentUser=null; activeUserId=null;
    document.body.classList.add("auth-required");
    $("auth-screen").hidden=false;
    $("profile-menu").hidden=true;
    $("login-password").value="";
    setStatus("Belum masuk");
  }
  db.auth.onAuthStateChange((event,session)=>{
    if(event==="SIGNED_OUT") showLogin();
    else if(event==="SIGNED_IN") setTimeout(()=>activateSession(session),0);
  });
  showLogin();
  setStatus("Menghubungkan...");
  db.auth.getSession().then(({data,error})=>{
    if(error) throw error;
    if(data.session) return activateSession(data.session);
    setStatus("Silakan masuk");
  }).catch(err=>{setStatus("Koneksi autentikasi gagal",true);$("login-error").textContent=err.message;$("login-error").hidden=false;});
})();