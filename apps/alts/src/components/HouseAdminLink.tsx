import { Link } from "react-router-dom";
import { houseAdminHref, houseAdminIsExternal } from "@alts/lib/houseAdmin";

type Props = {
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  "data-testid"?: string;
};

/** Floor Admin control — in-app on app., reverse jump to app.lstailors.com on alts. */
export function HouseAdminLink({
  className,
  children,
  "aria-label": ariaLabel = "Open admin",
  "data-testid": testId,
}: Props) {
  const href = houseAdminHref();
  if (houseAdminIsExternal()) {
    return (
      <a href={href} className={className} aria-label={ariaLabel} data-testid={testId}>
        {children}
      </a>
    );
  }
  return (
    <Link to={href} className={className} aria-label={ariaLabel} data-testid={testId}>
      {children}
    </Link>
  );
}
