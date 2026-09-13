import type { Metadata } from "next";

import PaymentView from "./PaymentView";

export const metadata: Metadata = {
  title: "Payment",
};

export default function PaymentPage() {
  return <PaymentView />;
}
