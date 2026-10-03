import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <div className="pagehead">
        <h1>Not on the form</h1>
      </div>
      <p className="empty">
        This address has not been indexed since capture start. Pools and configs appear here once the indexer sees them on mainnet.{" "}
        <Link href="/">Back to the Form</Link>.
      </p>
    </>
  );
}
