import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import './sidebar.css';

type SidebarContextProps = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  animate: boolean;
  mobile: boolean;
};

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);
const mobileQuery = '(max-width: 767px)';
function subscribeMobile(onChange: () => void) {
  const query = window.matchMedia?.(mobileQuery);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}
function isMobile() {
  return window.matchMedia?.(mobileQuery).matches ?? false;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider');
  return context;
}

type SidebarProps = {
  children: ReactNode;
  open?: boolean;
  setOpen?: Dispatch<SetStateAction<boolean>>;
  animate?: boolean;
};

export function SidebarProvider({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: SidebarProps) {
  const [openState, setOpenState] = useState(false);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile, () => false);
  const previousMobile = useRef(mobile);
  const open = openProp ?? openState;
  const setOpen = setOpenProp ?? setOpenState;
  useEffect(() => {
    if (previousMobile.current !== mobile) setOpen(false);
    previousMobile.current = mobile;
  }, [mobile, setOpen]);
  return (
    <SidebarContext.Provider value={{ open, setOpen, animate, mobile }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function Sidebar(props: SidebarProps) {
  return <SidebarProvider {...props} />;
}

type SidebarBodyProps = Omit<ComponentProps<typeof motion.aside>, 'children'> & {
  children: ReactNode;
  mobileHeader?: ReactNode;
};

export function SidebarBody({ mobileHeader, children, className, ...props }: SidebarBodyProps) {
  const { mobile } = useSidebar();
  return mobile ? (
    <MobileSidebar className={className} header={mobileHeader}>
      {children}
    </MobileSidebar>
  ) : (
    <DesktopSidebar className={className} {...props}>
      {children}
    </DesktopSidebar>
  );
}

export function DesktopSidebar({
  className,
  children,
  ...props
}: ComponentProps<typeof motion.aside>) {
  const { open, setOpen, animate } = useSidebar();
  const reducedMotion = useReducedMotion();
  const expanded = !animate || open;
  return (
    <motion.aside
      {...props}
      className={cn('sidebar-desktop flex shrink-0 flex-col', className)}
      aria-label="Основное меню"
      data-open={expanded}
      initial={false}
      animate={{ width: expanded ? 300 : 60 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: 'easeInOut' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
      }}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).closest('[data-sidebar-toggle]')) return;
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(true);
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !event.currentTarget.matches(':hover')
        )
          setOpen(false);
      }}
    >
      {children}
    </motion.aside>
  );
}

export function MobileSidebar({
  className,
  children,
  header,
}: {
  className?: string;
  children: ReactNode;
  header?: ReactNode;
}) {
  const { open, setOpen, animate } = useSidebar();
  const reducedMotion = useReducedMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (!element.open) element.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = overflow;
        element.close();
        trigger.current?.focus();
      };
    }
  }, [open]);
  return (
    <>
      <header className="sidebar-mobile-bar">
        {header}
        <button
          ref={trigger}
          type="button"
          className="sidebar-icon-button"
          aria-label="Открыть меню"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(true)}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
      </header>
      <dialog
        ref={dialog}
        id={menuId}
        className="sidebar-mobile-dialog"
        aria-label="Меню разделов"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <motion.div
          className={cn('sidebar-mobile-content flex flex-col', className)}
          initial={false}
          animate={{ x: open || reducedMotion || !animate ? 0 : '-100%', opacity: open ? 1 : 0 }}
          transition={{ duration: reducedMotion || !animate ? 0 : 0.25, ease: 'easeInOut' }}
        >
          <button
            type="button"
            className="sidebar-icon-button sidebar-mobile-close"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
          >
            <X size={22} aria-hidden="true" />
          </button>
          {children}
        </motion.div>
      </dialog>
    </>
  );
}

type SidebarLinkProps = Omit<ComponentProps<'a'>, 'href' | 'children'> & {
  link: { label: string; href: string; icon: ReactNode };
};

export function SidebarLink({ link, className, ...props }: SidebarLinkProps) {
  const { open, animate, mobile } = useSidebar();
  const reducedMotion = useReducedMotion();
  const expanded = mobile || !animate || open;
  return (
    <a
      {...props}
      href={link.href}
      aria-label={link.label}
      title={expanded ? undefined : link.label}
      className={cn('sidebar-link group/sidebar flex items-center gap-3', className)}
    >
      <span className="sidebar-link-icon shrink-0" aria-hidden="true">
        {link.icon}
      </span>
      <motion.span
        initial={false}
        animate={{ opacity: expanded ? 1 : 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.15 }}
        aria-hidden={!expanded}
        className="sidebar-link-label whitespace-nowrap"
      >
        {link.label}
      </motion.span>
    </a>
  );
}
