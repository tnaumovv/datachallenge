import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { PanelLeftClose, PanelLeftOpen, Settings2 } from 'lucide-react';
import { Sidebar, SidebarBody, SidebarLink, useSidebar } from '@/components/ui/sidebar';
import { DisplaySettings } from './DisplaySettings';
import { Icon } from './Icon';
import type { ReviewLocation } from './navigation';

type WorkspaceSidebarProps = {
  activePage: ReviewLocation['page'];
  titles: Record<ReviewLocation['page'], string>;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, page: ReviewLocation['page']) => boolean;
};

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const [open, setOpen] = useState(false);
  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody mobileHeader={<WorkspaceBrand onNavigate={props.onNavigate} />}>
        <WorkspaceSidebarContent {...props} />
      </SidebarBody>
    </Sidebar>
  );
}

function WorkspaceBrand({ onNavigate }: Pick<WorkspaceSidebarProps, 'onNavigate'>) {
  const { open, mobile } = useSidebar();
  return (
    <a
      className="workspace-sidebar-brand"
      href="/dialogs"
      aria-label="Freedom CQA — Диалоги"
      data-expanded={open || mobile}
      onClick={(event) => onNavigate(event, 'dialogs')}
    >
      <span className="freedom-logo" aria-hidden="true" />
    </a>
  );
}

function WorkspaceSidebarContent({ activePage, titles, onNavigate }: WorkspaceSidebarProps) {
  const { open, setOpen, mobile } = useSidebar();
  const settings = useRef<HTMLDivElement>(null);
  const focusSettings = useRef(false);
  useEffect(() => {
    if (open && focusSettings.current) {
      settings.current?.querySelector('button')?.focus();
      focusSettings.current = false;
    }
  }, [open]);
  function navigate(event: MouseEvent<HTMLAnchorElement>, page: ReviewLocation['page']) {
    const navigated = onNavigate(event, page);
    if (navigated && mobile) setOpen(false);
    return navigated;
  }
  return (
    <>
      <div className="workspace-sidebar-header">
        <WorkspaceBrand onNavigate={navigate} />
        {!mobile && (
          <button
            type="button"
            className="sidebar-icon-button"
            data-sidebar-toggle
            aria-label={open ? 'Свернуть меню' : 'Развернуть меню'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? (
              <PanelLeftClose size={20} aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={20} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <nav className="workspace-sidebar-nav" aria-label="Разделы">
        {(
          [
            'overview',
            'dialogs',
            'review',
            'checklists',
            'appeals',
            'knowledge',
            'operations',
          ] as const
        ).map((page) => (
          <SidebarLink
            key={page}
            link={{
              label: titles[page],
              href: '/' + page,
              icon: (
                <Icon
                  name={
                    page === 'knowledge'
                      ? 'checklists'
                      : page === 'review'
                        ? 'shield'
                        : page === 'operations'
                          ? 'layers'
                          : page
                  }
                />
              ),
            }}
            aria-current={activePage === page ? 'page' : undefined}
            onClick={(event) => navigate(event, page)}
          />
        ))}
      </nav>
      <div className="workspace-sidebar-settings">
        {!open && !mobile && (
          <button
            type="button"
            className="sidebar-icon-button workspace-sidebar-settings-trigger"
            data-sidebar-toggle
            aria-label="Настройки отображения"
            title="Настройки отображения"
            onClick={() => {
              focusSettings.current = true;
              setOpen(true);
            }}
          >
            <Settings2 size={20} aria-hidden="true" />
          </button>
        )}
        <div ref={settings} hidden={!open && !mobile}>
          <DisplaySettings />
        </div>
      </div>
    </>
  );
}
