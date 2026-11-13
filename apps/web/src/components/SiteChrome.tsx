import Link from "next/link";
import { NotificationsMenu } from "@/components/NotificationsMenu";
import { BackButton } from "@/components/BackButton";

const links = [
  ["Find Jobs", "/jobs"],
  ["Companies", "/companies"],
  ["Career Resources", "/faqs"],
  ["For Employers", "/for-recruiters"],
  ["For Institutions", "/institutions"],
] as const;

export function Header() {
  return (
    <header className="topbar">
      <div className="wrap nav">
        <div className="navLeft">
          <Link className="brand" href="/">Jobinfo India</Link>
          <nav aria-label="Main navigation">
            {links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
          </nav>
        </div>
        <div className="navRight">
          <NotificationsMenu />
          <Link className="btn outline sm" href="/login">Login</Link>
          <Link className="btn sm" href="/register">Register</Link>
        </div>
        <details className="mobileMenu">
          <summary aria-label="Open site navigation">Menu</summary>
          <nav aria-label="Mobile navigation">
            {links.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
            <Link href="/login">Login</Link><Link href="/register">Register</Link>
            <Link href="/about">About us</Link><Link href="/contact">Contact</Link><Link href="/faqs">FAQs</Link>
          </nav>
        </details>
      </div>
    </header>
  );
}

const footerLinks = [
  ["About us", "/about"], ["Contact", "/contact"], ["Help centre", "/faqs"],
  ["Find jobs", "/jobs"], ["Companies", "/companies"], ["For employers", "/for-recruiters"],
  ["For institutions", "/institutions"], ["Plans and pricing", "/pricing"],
] as const;

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <b>Jobinfo India</b>
        <nav className="footLinks" aria-label="Footer navigation">
          {footerLinks.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
        <small>© 2026 Jobinfo India. All rights reserved.</small>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: React.ReactNode }) {
  return <><Header /><BackButton />{children}<Footer /></>;
}
