# Al Bonian FM Snagging Application
## Build prompt

Build a responsive, mobile-friendly snagging and reinstatement application for Al Bonian FM (ABFM). Deliver a working application with authenticated roles, persistent records, file uploads, approval workflows, versioned document generation and an end-to-end demonstration. Use the supplied CAFM End of Lease (EOL) requirements and sample forms as the baseline for field names and document templates. Apply the workflow and controls below.

## 1. Client request and CAFM traceability

- Allow a client representative or ABFM coordinator to register a snagging request. Capture client, contract, site, building, unit/area, requester and contact, requested date, priority, description, attachments and client/CAFM reference. Record intake channel, received timestamp, assigned owner and due date. Support requests received outside the application through manual intake.
- Create one master snagging case with a unique ID. Use the existing APM Move-Out Inspection Task ID when available. If CAFM uses separate Inspection and Reinstatement tasks, link both to the master case and carry the inspection observations, photos, quantities, recommendations and reports into the reinstatement view automatically. Prevent duplicate imports for the same external task. Allow manual linking when CAFM integration is unavailable. Verify supported CAFM interfaces before implementing live synchronization.

## 2. ABFM Engineer inspection and snag confirmation

- Assign the inspection to an ABFM Engineer. Capture inspection date and inspector, and give each snag a stable ID. For each snag capture exact location, category, severity, description, recommended rectification, measured quantity, unit and one or more before photos from the camera or gallery. Support typed notes and voice-to-text where supported, with typed entry always available. Allow photo annotation while retaining originals.
- Provide Sqm, LM, RM, Nos., Pair, LS, m3, Set, Lot, Roll, Box and Other (custom). Support decimal quantities where applicable. Keep unit conversions explicit and reviewed.
- Allow the Engineer to confirm, return for clarification, or reject each observation with a reason. Require Engineer confirmation and a published initial inspection report before an item can enter an RFQ. Generate the inspection PDF in the approved ABFM format, including the inspector and the lessee acknowledgement name, signature and date where applicable. Use the source acknowledgement wording in the EOL template. Record who signed and when.
- Allow the assigned Engineer to correct the report before quotation approval. After approval, restrict edits to authorized personnel and require a reason and new revision. Changes affecting approved scope or pricing require renewed approval before affected work proceeds.

## 3. RFQ to Rahati Bayti and Guardian

- Allow authorized ABFM procurement staff to select confirmed snags, group them into an RFQ and issue independent invitations to Rahati Bayti and Guardian. Include case and RFQ references, property location, line-level scope, measured quantities and units, photos, applicable BOQ references, site instructions, quote deadline and requested delivery period.
- Provide an RFQ preview, a supplier portal or configured email delivery, and a record of recipients, version, issue date and delivery status. Preserve the issued version. Allow clarifications and revised RFQs with history. Give each supplier access only to the RFQs and jobs assigned to it and to fields ABFM has approved for disclosure.

## 4. BOQ-based quotation and authorization

- Maintain versioned client-contract Bills of Quantities (BOQs). Import approved lines from Excel with contract, revision, effective dates, item reference, description, category, unit and client contract rate. Validate duplicates and missing or invalid fields before publishing a revision. Selecting a BOQ reference must fill the approved description, unit, rate and category in the authorized ABFM view.
- Require each invited supplier to quote against the RFQ lines and corresponding client BOQ references, using matching scope and units. Record its offered quantity, supplier unit rate, exclusions, validity, lead time, warranty and payment terms. Maintain the supplier rate and the client contract rate as distinct fields. Make policy configurable if the agreement requires rate parity or another approved supplier pricing rule. Restrict access to commercial fields by role and document audience.
- Show the ABFM reviewer the confirmed quantity, quoted quantity, BOQ unit and rates side by side. Flag unmapped lines, unit/quantity differences and rate exceptions. Route non-BOQ work through an explicit variation with custom description, unit, quantity, rate, justification and the required approvals. Keep quote revisions immutable after submission and show line-level comparisons. Snapshot the BOQ revision and approved rates so later contract edits cannot change approved jobs.
- Generate an ABFM client quotation from the reviewed scope. Capture client contact, quotation reference, inspection date, validity, contractual completion period from order confirmation, warranty, payment terms and remarks. Calculate line totals, subtotal, amount or percentage discount, total after discount, VAT and grand total with consistent decimal rounding. Default the VAT setting to the source document's 5%, subject to authorized configuration. Record and authorize any cost adjustment without editing the approved BOQ rate.
- Generate audience-specific PDFs using approved templates. The DP World/client version includes line number, before photos, BOQ reference and description, unit, quantity, unit price, line total, quotation total and remarks. The tenant version includes line number, before photos, BOQ reference, BOQ description and total price. Apply these limits to downloads and underlying data access.
- Require CS approval, client submission, client approval and an applicable PO or work-order reference before releasing the job. Record approval identity, date, approved revision and amount. Support requests for revision and rejection with a reason. Configure approvers and PO requirements by contract.

## 5. Job execution and final snagging

- Release a work order to the awarded supplier with approved line quantities, target dates, site access instructions and relevant attachments. Track planned and actual start/finish dates, responsibility, progress, completed quantity, evidence, delays and hold reasons. Capture after photos against the same snag or approved work line and display before and after photos together.
- Route scope or quantity changes during execution for variation approval before releasing the changed work. Allow partial completion with verified quantity, remaining quantity, reason and target date. Keep outstanding items assigned and visible.
- When the awarded supplier submits its prepared WCR and evidence, require the ABFM Engineer to reinspect and record the date, evidence and decision on each line. Pass acceptable items and return failed items to the awarded supplier with comments, required action and due date. Retain every reinspection round. Close the job only after all required items pass and required sign-offs are captured. An authorized scope omission requires a documented approval and must appear in the report.

## 6. Work Completion Report and document history

- Generate a draft Work Completion Report for review and auto-generate the final PDF upon verified completion and required sign-off. Include case and CAFM references, site and unit, subcontractor, approved quotation and PO/work-order references, approved amount, actual work dates, each approved BOQ or variation line, approved and verified quantities, completion status, paired before/after evidence, Engineer remarks and sign-off, plus client or lessee acknowledgement where required.
- Provide clearly labeled partial reports showing outstanding work and keep the case open. Store the initial Inspection Report, RFQ, supplier quotation, client and tenant quotations, and Work Completion Report under the master case. Preserve issued versions and dates. Support Excel exports for authorized registers and line-level data.

## 7. Roles, notifications and dashboard

- Enforce case and field access on the server for Client, ABFM Coordinator, ABFM Engineer, ABFM Procurement, CS Approver, Rahati Bayti, Guardian and Administrator. Limit client views to their own properties and approved documents. Restrict downloads and audit document issuance, amendments, approvals, rejections and reopening with user, timestamp and reason.
- Implement separate case and item statuses. The main case sequence is Received  Inspection Assigned  Snags Confirmed  RFQ Issued  Quote Received  CS Approval  Client Submission  Client Approval  Authorized  In Progress  Reinspection  Closed. Support On Hold, Cancelled and Reopened with reasons, and return failed work to execution. Keep partial completion visible without closing the case.
- Send in-app notifications and configured email alerts for assignments, RFQ issue, quotation receipt, approvals, overdue actions, reinspection failures and completion report release. Show owner, due date and pending action on each case. Provide filters by client, site, status, engineer, supplier and date, with counts for open and overdue cases, outstanding snags, approvals and completed work. Display operational dates in Dubai time.

## Acceptance criteria

1. A client request can be followed from intake to final report using one case ID, including linked Inspection and Reinstatement CAFM references when supplied.
2. An unconfirmed snag cannot be issued to either subcontractor. A revised RFQ and revised quotation remain linked to their original records.
3. A matching BOQ line populates contract data. A mismatched unit, missing BOQ mapping or disallowed rate exception requires resolution before approval. A later BOQ revision leaves approved quotations unchanged.
4. Users cannot start unauthorized work or access another client's or subcontractor's records. The tenant PDF and download data contain only approved tenant fields.
5. A failed or partially finished item stays open and appears in the partial report. After successful rectification and reinspection, the system generates the final report with paired evidence and approval references.
6. Provide a demo case with multiple snag lines, one variation, one quotation revision and one failed reinspection followed by closure. Include setup instructions, configuration placeholders, and verification steps. Confirm live CAFM access, commercial approval rules, sharing of client rates with Rahati Bayti and report templates with ABFM before production rollout.

## Revised DP World requirements

- Use a maximum of 6 days below AED 25,500 and 10 days from AED 25,500 through AED 42,500 inclusive. Above AED 42,500 record the completion period agreed for the scope. Start the clock on order confirmation. Confirm the VAT basis and calendar versus working days before production.
- Record independent bids and revisions from Rahati Bayti and Guardian, the commercial comparison and the award decision. Restrict bid access to ABFM and the supplier that submitted it.
- Require CS approval of the exact client quotation revision before client submission. Require subsequent client approval and PO/work-order reference before execution. Material quote changes reset affected approvals.
- Retain the WCR as submitted by the awarded supplier and generate the verified ABFM report after Engineer reinspection and required signatures.
- Reuse the supplied DP World Dynamics inspection, client quotation, tenant quotation and WCR layouts, including existing headers, field order, photos and signature blocks. Reference the supplied completion-photo workbook, warranty certificate and non-BOQ comparison workbook where applicable. Validate completed outputs with DP World before production.
- Use supplied ABFM branding in the main interface and Rahati Bayti branding in Rahati Bayti views. Display Guardian by name pending its logo. Publish private source with synthetic fixtures only.
- Support No Reinstatement Required after the Engineer confirms the inspection and publishes the report.

