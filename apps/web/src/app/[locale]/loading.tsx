export default function Loading() {
  return (
    <div className="container-shell py-12">
      <div className="skeleton h-4 w-32 rounded" />
      <div className="skeleton mt-4 h-10 w-2/3 rounded" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton h-72 rounded-[14px]" />)}
      </div>
    </div>
  );
}
